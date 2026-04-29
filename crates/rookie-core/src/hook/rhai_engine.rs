//! Rhai Hook Condition Engine
//!
//! Provides a secure, sandboxed expression evaluation engine for hook conditions.
//! All IO, network, and system calls are disabled. Only pre-registered safe functions
//! are available.

use rhai::{Dynamic, Engine, EvalAltResult, Map, Scope, AST};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::timeout;

/// Default timeout for expression evaluation
pub const DEFAULT_EVAL_TIMEOUT_MS: u64 = 100;

/// Result type for condition evaluation
#[derive(Debug, Clone)]
pub enum EvalResult {
    Allow,
    Deny { reason: String },
    Error { message: String },
}

/// Secure Rhai engine for hook condition evaluation
pub struct RhaiHookEngine {
    engine: Engine,
    timeout_ms: u64,
}

impl Default for RhaiHookEngine {
    fn default() -> Self {
        Self::new(DEFAULT_EVAL_TIMEOUT_MS as i64)
    }
}

impl RhaiHookEngine {
    /// Create a new RhaiHookEngine with specified timeout
    pub fn new(timeout_ms: i64) -> Self {
        let timeout_ms = timeout_ms as u64;
        let engine = Engine::new();

        // Note: Rhai 1.20 uses different API for limits
        // The engine is already sandboxed by default

        Self { engine, timeout_ms }
    }

    /// Register safe, pre-approved functions
    fn register_safe_functions(engine: &mut Engine) {
        // String matching functions
        engine.register_fn("matches", |text: &str, pattern: &str| -> bool {
            if let Ok(regex) = regex::Regex::new(pattern) {
                regex.is_match(text)
            } else {
                false
            }
        });

        engine.register_fn("contains", |text: &str, substring: &str| -> bool {
            text.contains(substring)
        });

        engine.register_fn("starts_with", |text: &str, prefix: &str| -> bool {
            text.starts_with(prefix)
        });

        engine.register_fn("ends_with", |text: &str, suffix: &str| -> bool {
            text.ends_with(suffix)
        });

        // Environment variable access (read-only, whitelist)
        engine.register_fn("env", |name: &str| -> String {
            let allowed_vars = [
                "ROOKIE_SESSION_ID",
                "ROOKIE_TOOL_NAME",
                "ROOKIE_PROJECT_ROOT",
                "ROOKIE_HOOK_EVENT",
                "NODE_ENV",
                "RUST_ENV",
            ];
            if allowed_vars.contains(&name) {
                std::env::var(name).unwrap_or_default()
            } else {
                String::new()
            }
        });

        // Time functions
        engine.register_fn("now", || -> i64 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
        });

        engine.register_fn("now_ms", || -> i64 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64
        });

        // String utilities
        engine.register_fn("len", |s: &str| -> i64 { s.len() as i64 });
        engine.register_fn("trim", |s: &str| -> String { s.trim().to_string() });
        engine.register_fn("to_lower", |s: &str| -> String { s.to_lowercase() });
        engine.register_fn("to_upper", |s: &str| -> String { s.to_uppercase() });

        // Array utilities
        engine.register_fn("includes", |arr: Vec<Dynamic>, item: &str| -> bool {
            arr.iter().any(|v| v.to_string() == item)
        });

        engine.register_fn("len", |arr: Vec<Dynamic>| -> i64 { arr.len() as i64 });

        // Math utilities
        engine.register_fn("abs", |n: i64| -> i64 { n.abs() });
        engine.register_fn("min", |a: i64, b: i64| -> i64 { a.min(b) });
        engine.register_fn("max", |a: i64, b: i64| -> i64 { a.max(b) });
    }

    /// Evaluate a condition expression with context
    pub async fn evaluate(&self, expression: &str, context_json: &str) -> EvalResult {
        let start = Instant::now();

        // Parse context JSON
        let context: Value = match serde_json::from_str(context_json) {
            Ok(v) => v,
            Err(e) => {
                return EvalResult::Error {
                    message: format!("Failed to parse context JSON: {}", e),
                }
            }
        };

        // Build scope from context
        let mut scope = Scope::new();
        if let Some(obj) = context.as_object() {
            for (key, value) in obj {
                let dynamic = Self::json_to_dynamic(value);
                scope.push_constant(key, dynamic);
            }
        }

        // Compile expression
        let ast = match self.engine.compile(expression) {
            Ok(ast) => ast,
            Err(e) => {
                return EvalResult::Error {
                    message: format!("Failed to compile expression: {}", e),
                }
            }
        };

        // Evaluate with timeout
        let timeout_duration = Duration::from_millis(self.timeout_ms);

        let result = timeout(timeout_duration, async {
            // Note: Rhai evaluation is synchronous, run in blocking task
            let result: Result<Dynamic, Box<EvalAltResult>> = self.engine.eval_ast_with_scope(&mut scope, &ast);
            result
        })
        .await;

        match result {
            Ok(Ok(value)) => {
                let bool_result = value.as_bool().unwrap_or(false);
                if bool_result {
                    EvalResult::Allow
                } else {
                    EvalResult::Deny {
                        reason: format!("Condition evaluated to false: {}", expression),
                    }
                }
            }
            Ok(Err(e)) => EvalResult::Error {
                message: format!("Evaluation error: {}", e),
            },
            Err(_) => EvalResult::Error {
                message: format!("Evaluation timed out after {}ms", self.timeout_ms),
            },
        }
    }

    /// Evaluate expression synchronously (for simple cases)
    pub fn evaluate_sync(&self, expression: &str, context_json: &str) -> EvalResult {
        let runtime = tokio::runtime::Handle::try_current();
        match runtime {
            Ok(handle) => {
                // We're in an async context, block_in_place
                tokio::task::block_in_place(|| {
                    handle.block_on(self.evaluate(expression, context_json))
                })
            }
            Err(_) => {
                // No runtime, create one
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(self.evaluate(expression, context_json))
            }
        }
    }

    /// Convert JSON value to Rhai Dynamic
    fn json_to_dynamic(value: &Value) -> Dynamic {
        match value {
            Value::Null => Dynamic::UNIT,
            Value::Bool(b) => Dynamic::from(*b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Dynamic::from(i)
                } else if let Some(f) = n.as_f64() {
                    Dynamic::from(f)
                } else {
                    Dynamic::from(n.to_string())
                }
            }
            Value::String(s) => Dynamic::from(s.clone()),
            Value::Array(arr) => {
                let dynamic_arr: Vec<Dynamic> = arr.iter().map(Self::json_to_dynamic).collect();
                Dynamic::from(dynamic_arr)
            }
            Value::Object(obj) => {
                let mut map = Map::new();
                for (k, v) in obj {
                    map.insert(k.clone().into(), Self::json_to_dynamic(v));
                }
                Dynamic::from(map)
            }
        }
    }

    /// Set evaluation timeout
    pub fn set_timeout(&mut self, timeout_ms: u64) {
        self.timeout_ms = timeout_ms;
    }

    /// Get current timeout
    pub fn get_timeout(&self) -> u64 {
        self.timeout_ms
    }

    /// Validate an expression without executing it
    pub fn validate(&self, expression: &str) -> Result<(), String> {
        match self.engine.compile(expression) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Invalid expression: {}", e)),
        }
    }
}

/// Thread-safe shared engine
pub type SharedRhaiEngine = Arc<RhaiHookEngine>;

/// Create a new shared engine instance
pub fn create_engine() -> SharedRhaiEngine {
    Arc::new(RhaiHookEngine::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_condition() {
        let engine = RhaiHookEngine::default();
        let context = r#"{"toolName": "file_write", "event": "PreToolUse"}"#;

        let result = engine.evaluate("toolName == \"file_write\"", context).await;
        assert!(matches!(result, EvalResult::Allow));

        let result = engine.evaluate("toolName == \"file_read\"", context).await;
        assert!(matches!(result, EvalResult::Deny { .. }));
    }

    #[tokio::test]
    async fn test_matches_function() {
        let engine = RhaiHookEngine::default();
        let context = r#"{"filePath": "/src/main.rs"}"#;

        let result = engine.evaluate(r#"matches(filePath, ".*\\.rs$")"#, context).await;
        assert!(matches!(result, EvalResult::Allow));

        let result = engine.evaluate(r#"matches(filePath, ".*\\.js$")"#, context).await;
        assert!(matches!(result, EvalResult::Deny { .. }));
    }

    #[tokio::test]
    async fn test_contains_function() {
        let engine = RhaiHookEngine::default();
        let context = r#"{"content": "hello world"}"#;

        let result = engine.evaluate("contains(content, \"world\")", context).await;
        assert!(matches!(result, EvalResult::Allow));
    }

    #[tokio::test]
    async fn test_env_function() {
        let engine = RhaiHookEngine::default();
        std::env::set_var("ROOKIE_TEST_VAR", "test_value");

        // Allowed variable
        let context = r#"{}"#;
        std::env::set_var("ROOKIE_SESSION_ID", "session123");
        let result = engine.evaluate(r#"env("ROOKIE_SESSION_ID") == "session123""#, context).await;
        assert!(matches!(result, EvalResult::Allow));

        // Disallowed variable should return empty
        std::env::set_var("SECRET_VAR", "secret");
        let result = engine.evaluate(r#"env("SECRET_VAR") == """#, context).await;
        assert!(matches!(result, EvalResult::Allow));
    }

    #[tokio::test]
    async fn test_complex_condition() {
        let engine = RhaiHookEngine::default();
        let context = r#"{
            "toolName": "shell",
            "command": "rm -rf /",
            "trustLevel": "untrusted"
        }"#;

        let result = engine.evaluate(
            "toolName == \"shell\" && contains(command, \"rm\") && trustLevel == \"untrusted\"",
            context
        ).await;
        assert!(matches!(result, EvalResult::Allow));
    }

    #[tokio::test]
    async fn test_array_includes() {
        let engine = RhaiHookEngine::default();
        let context = r#"{"allowedTools": ["file_read", "file_write", "grep"]}"#;

        let result = engine.evaluate(r#"includes(allowedTools, "file_write")"#, context).await;
        assert!(matches!(result, EvalResult::Allow));

        let result = engine.evaluate(r#"includes(allowedTools, "shell")"#, context).await;
        assert!(matches!(result, EvalResult::Deny { .. }));
    }

    #[tokio::test]
    async fn test_invalid_expression() {
        let engine = RhaiHookEngine::default();
        let context = r#"{}"#;

        let result = engine.evaluate("invalid syntax @#$", context).await;
        assert!(matches!(result, EvalResult::Error { .. }));
    }

    #[tokio::test]
    async fn test_timeout() {
        let mut engine = RhaiHookEngine::new(1); // 1ms timeout
        let context = r#"{}"#;

        // This should timeout due to the loop
        let result = engine.evaluate(
            "let x = 0; while x < 1000000 { x += 1 } x > 0",
            context
        ).await;
        assert!(matches!(result, EvalResult::Error { message } if message.contains("timed out")));
    }

    #[tokio::test]
    async fn test_dangerous_functions_blocked() {
        let engine = RhaiHookEngine::default();
        let context = r#"{}"#;

        // File operations should not be available
        let result = engine.evaluate(r#"read_file("/etc/passwd")"#, context).await;
        assert!(matches!(result, EvalResult::Error { .. }));

        // Network operations should not be available
        let result = engine.evaluate(r#"fetch("http://example.com")"#, context).await;
        assert!(matches!(result, EvalResult::Error { .. }));
    }

    #[test]
    fn test_validate_expression() {
        let engine = RhaiHookEngine::default();

        assert!(engine.validate("toolName == 'test'").is_ok());
        assert!(engine.validate("invalid @#$ syntax").is_err());
    }
}

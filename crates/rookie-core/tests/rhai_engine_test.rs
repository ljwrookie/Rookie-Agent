//! Rhai Hook Engine Tests - P6-T1
//!
//! Tests for the secure condition evaluation engine

use rookie_core::hook::{EvalResult, RhaiHookEngine};

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

    let result = engine.evaluate("contains(content, \"foo\")", context).await;
    assert!(matches!(result, EvalResult::Deny { .. }));
}

#[tokio::test]
async fn test_env_function() {
    let engine = RhaiHookEngine::default();
    std::env::set_var("ROOKIE_SESSION_ID", "session123");

    let context = r#"{}"#;
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

#[test]
fn test_eval_result_helpers() {
    let allow = EvalResult::Allow;
    assert!(allow.is_allowed());
    assert!(!allow.is_denied());
    assert!(!allow.is_error());
    assert!(allow.error_message().is_none());

    let deny = EvalResult::Deny { reason: "test".to_string() };
    assert!(!deny.is_allowed());
    assert!(deny.is_denied());
    assert!(!deny.is_error());

    let error = EvalResult::Error { message: "error".to_string() };
    assert!(!error.is_allowed());
    assert!(!error.is_denied());
    assert!(error.is_error());
    assert_eq!(error.error_message(), Some("error".to_string()));
}

#[tokio::test]
async fn test_string_functions() {
    let engine = RhaiHookEngine::default();

    // Test starts_with
    let context = r#"{"path": "/home/user/file.txt"}"#;
    let result = engine.evaluate(r#"starts_with(path, "/home")"#, context).await;
    assert!(matches!(result, EvalResult::Allow));

    // Test ends_with
    let result = engine.evaluate(r#"ends_with(path, ".txt")"#, context).await;
    assert!(matches!(result, EvalResult::Allow));

    // Test len
    let context = r#"{"text": "hello"}"#;
    let result = engine.evaluate("len(text) == 5", context).await;
    assert!(matches!(result, EvalResult::Allow));

    // Test to_lower
    let context = r#"{"name": "HELLO"}"#;
    let result = engine.evaluate(r#"to_lower(name) == "hello""#, context).await;
    assert!(matches!(result, EvalResult::Allow));
}

#[tokio::test]
async fn test_math_functions() {
    let engine = RhaiHookEngine::default();
    let context = r#"{"value": -5}"#;

    let result = engine.evaluate("abs(value) == 5", context).await;
    assert!(matches!(result, EvalResult::Allow));

    let context = r#"{"a": 3, "b": 5}"#;
    let result = engine.evaluate("min(a, b) == 3", context).await;
    assert!(matches!(result, EvalResult::Allow));

    let result = engine.evaluate("max(a, b) == 5", context).await;
    assert!(matches!(result, EvalResult::Allow));
}

#[tokio::test]
async fn test_now_function() {
    let engine = RhaiHookEngine::default();
    let context = r#"{}"#;

    // now() should return a timestamp greater than 0
    let result = engine.evaluate("now() > 0", context).await;
    assert!(matches!(result, EvalResult::Allow));

    // now_ms() should also work
    let result = engine.evaluate("now_ms() > 0", context).await;
    assert!(matches!(result, EvalResult::Allow));
}

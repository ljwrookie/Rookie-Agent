pub mod rhai_engine;
pub mod types;

pub use rhai_engine::{create_engine, EvalResult, RhaiHookEngine, SharedRhaiEngine};
pub use types::*;

#[cfg(feature = "napi")]
use napi::bindgen_prelude::*;
#[cfg(feature = "napi")]
use napi_derive::napi;
use std::sync::Arc;

/// NAPI-exposed condition evaluator
#[cfg(feature = "napi")]
#[napi]
pub struct ConditionEvaluator {
    engine: Arc<RhaiHookEngine>,
}

#[cfg(feature = "napi")]
#[napi]
impl ConditionEvaluator {
    /// Create a new condition evaluator
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            engine: Arc::new(RhaiHookEngine::default()),
        }
    }

    /// Create with custom timeout (in milliseconds)
    #[napi(factory)]
    pub fn with_timeout(timeout_ms: i64) -> Self {
        Self {
            engine: Arc::new(RhaiHookEngine::new(timeout_ms)),
        }
    }

    /// Evaluate a condition expression with JSON context
    /// Returns true if condition passes, false otherwise
    #[napi]
    pub async fn evaluate(&self, expression: String, context_json: String) -> bool {
        let engine = self.engine.clone();
        let result = engine.evaluate(&expression, &context_json).await;
        matches!(result, EvalResult::Allow)
    }

    /// Evaluate synchronously
    #[napi]
    pub fn evaluate_sync(&self, expression: String, context_json: String) -> bool {
        self.engine.evaluate_sync(&expression, &context_json).is_allowed()
    }

    /// Validate an expression without executing
    #[napi]
    pub fn validate(&self, expression: String) -> Result<()> {
        self.engine
            .validate(&expression)
            .map_err(|e| Error::new(Status::InvalidArg, e))
    }

    /// Get current timeout
    #[napi(getter)]
    pub fn get_timeout(&self) -> u64 {
        self.engine.get_timeout()
    }
}

#[cfg(feature = "napi")]
impl Default for ConditionEvaluator {
    fn default() -> Self {
        Self::new()
    }
}

impl EvalResult {
    /// Check if evaluation result is allowed
    pub fn is_allowed(&self) -> bool {
        matches!(self, EvalResult::Allow)
    }

    /// Check if evaluation result is denied
    pub fn is_denied(&self) -> bool {
        matches!(self, EvalResult::Deny { .. })
    }

    /// Check if evaluation resulted in error
    pub fn is_error(&self) -> bool {
        matches!(self, EvalResult::Error { .. })
    }

    /// Get error message if any
    pub fn error_message(&self) -> Option<String> {
        match self {
            EvalResult::Error { message } => Some(message.clone()),
            _ => None,
        }
    }
}

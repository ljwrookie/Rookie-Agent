//! NAPI-RS Bridge for Rookie Agent
//!
//! Exposes Rust core functionality as Node.js native addon.
//! Uses napi-rs v3 with derive macros for type-safe bindings.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// Re-export core modules
use rookie_core::RookieServer;

// ─── Tokenizer Types ─────────────────────────────────────────────

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenCountRequest {
    pub text: String,
    pub model: Option<String>, // "cl100k_base" | "o200k_base"
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenCountResponse {
    pub count: u32,
    pub model: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TruncateRequest {
    pub text: String,
    pub max_tokens: u32,
    pub model: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TruncateResponse {
    pub text: String,
    pub original_count: u32,
    pub truncated_count: u32,
}

// ─── Context Pipeline Types ──────────────────────────────────────

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineMessage {
    pub role: String, // "user" | "assistant" | "system" | "tool"
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    pub metadata: Option<String>, // JSON string
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub params: String, // JSON string
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub max_tool_result_tokens: Option<u32>,
    pub snip_threshold: Option<u32>,
    pub max_messages: Option<u32>,
    pub compact_threshold: Option<f64>,
    pub context_window: Option<u32>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineStats {
    pub stage1_tool_results: u32,
    pub stage2_snipped: u32,
    pub stage3_normalized: u32,
    pub stage4_collapsed: u32,
    pub stage5_compacted: u32,
    pub total_tokens_before: u32,
    pub total_tokens_after: u32,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineResponse {
    pub messages: Vec<PipelineMessage>,
    pub stats: PipelineStats,
}

// ─── NAPI Addon Class ────────────────────────────────────────────

/// Main NAPI addon class exposing Rust functionality to Node.js
#[napi]
pub struct RookieNapi {
    inner: Arc<Mutex<RookieServer>>,
}

#[napi]
impl RookieNapi {
    /// Create a new RookieNapi instance
    #[napi(constructor)]
    pub fn new() -> Self {
        let server = RookieServer::new();

        Self {
            inner: Arc::new(Mutex::new(server)),
        }
    }

    /// Initialize the addon with configuration
    #[napi]
    pub async fn init(&self, config: String) -> Result<bool> {
        // Parse config JSON
        let _config: serde_json::Value = serde_json::from_str(&config)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid config JSON: {}", e)))?;
        
        // Initialize is successful
        Ok(true)
    }

    /// Ping the native addon for health check
    #[napi]
    pub async fn ping(&self) -> Result<String> {
        Ok("pong".to_string())
    }

    /// Count tokens in text using tiktoken
    #[napi]
    pub async fn count_tokens(&self, request: TokenCountRequest) -> Result<TokenCountResponse> {
        let model = request.model.unwrap_or_else(|| "cl100k_base".to_string());
        let count = crate::tokenizer::count_tokens(&request.text, &model)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Tokenization error: {}", e)))?;
        
        Ok(TokenCountResponse {
            count: count as u32,
            model,
        })
    }

    /// Truncate text to max tokens
    #[napi]
    pub async fn truncate_to_tokens(&self, request: TruncateRequest) -> Result<TruncateResponse> {
        let model = request.model.unwrap_or_else(|| "cl100k_base".to_string());
        let result = crate::tokenizer::truncate_to_tokens(&request.text, request.max_tokens as usize, &model)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Truncation error: {}", e)))?;
        
        Ok(TruncateResponse {
            text: result.text,
            original_count: result.original_count as u32,
            truncated_count: result.truncated_count as u32,
        })
    }

    /// Run the 5-stage context pipeline
    #[napi]
    pub async fn run_context_pipeline(
        &self,
        messages: Vec<PipelineMessage>,
        config: Option<PipelineConfig>,
    ) -> Result<PipelineResponse> {
        let config = config.unwrap_or_default();
        let result = crate::context::pipeline::run_pipeline(messages, config)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Pipeline error: {}", e)))?;
        
        Ok(result)
    }

    /// Process a generic request (for backward compatibility)
    #[napi]
    pub async fn request(&self, data: String) -> Result<String> {
        // Parse the request
        let request: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {}", e)))?;
        
        let method = request.get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        
        // Route to appropriate handler
        let response = match method {
            "ping" => serde_json::json!({
                "id": request.get("id"),
                "result": "pong"
            }),
            _ => serde_json::json!({
                "id": request.get("id"),
                "error": format!("Unknown method: {}", method)
            }),
        };
        
        Ok(response.to_string())
    }

    /// Register an event callback
    #[napi]
    pub fn on_event(&self, #[napi(ts_arg_type = "(event: string) => void")] _callback: Function<String, ()>) -> Result<()> {
        // Event handling would be implemented with napi-rs threadsafe functions
        // For now, this is a placeholder
        Ok(())
    }

    /// Close the addon connection
    #[napi]
    pub async fn close(&self) -> Result<()> {
        // Cleanup resources
        Ok(())
    }
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            max_tool_result_tokens: Some(8000),
            snip_threshold: Some(4000),
            max_messages: Some(50),
            compact_threshold: Some(0.8),
            context_window: Some(128000),
        }
    }
}

// ─── Module Submodules ───────────────────────────────────────────

pub mod tokenizer;
pub mod context;

// ─── Re-export for bindings ──────────────────────────────────────

pub use tokenizer::init_tokenizer;
pub use context::pipeline::run_pipeline_js;

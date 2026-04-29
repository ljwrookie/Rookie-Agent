//! Tokenizer module using tiktoken-rs
//!
//! Provides accurate token counting for OpenAI models with LRU caching.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use lru::LruCache;
use std::num::NonZeroUsize;

// Cache size for encoders
const ENCODER_CACHE_SIZE: usize = 10;

/// Tokenizer result for truncation
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TruncateResult {
    pub text: String,
    pub original_count: usize,
    pub truncated_count: usize,
}

/// Global encoder cache - stores encoder factory functions
static ENCODER_CACHE: Mutex<Option<LruCache<String, fn() -> Result<tiktoken_rs::CoreBPE>>>> = Mutex::new(None);

/// Initialize the tokenizer cache
#[napi]
pub fn init_tokenizer() -> Result<()> {
    let cache = LruCache::new(NonZeroUsize::new(ENCODER_CACHE_SIZE).unwrap());
    let mut global_cache = ENCODER_CACHE.lock()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Lock error: {}", e)))?;
    *global_cache = Some(cache);
    Ok(())
}

/// Get or create an encoder for the specified model
fn get_encoder(model: &str) -> Result<tiktoken_rs::CoreBPE> {
    // Map model to encoder factory
    let factory: fn() -> Result<tiktoken_rs::CoreBPE> = match model {
        "cl100k_base" | "gpt-4" | "gpt-4-turbo" | "gpt-3.5-turbo" => {
            || tiktoken_rs::cl100k_base()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load cl100k_base: {}", e)))
        }
        "o200k_base" | "gpt-4o" | "gpt-4o-mini" => {
            || tiktoken_rs::o200k_base()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load o200k_base: {}", e)))
        }
        "p50k_base" | "text-davinci-003" | "text-davinci-002" => {
            || tiktoken_rs::p50k_base()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load p50k_base: {}", e)))
        }
        "p50k_edit" | "text-davinci-edit-001" | "code-davinci-edit-001" => {
            || tiktoken_rs::p50k_edit()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load p50k_edit: {}", e)))
        }
        "r50k_base" | "gpt2" => {
            || tiktoken_rs::r50k_base()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load r50k_base: {}", e)))
        }
        _ => {
            // Default to cl100k_base for unknown models
            || tiktoken_rs::cl100k_base()
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load default encoder: {}", e)))
        }
    };

    // Try to get from cache first
    {
        let mut cache = ENCODER_CACHE.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Lock error: {}", e)))?;

        if cache.is_none() {
            *cache = Some(LruCache::new(NonZeroUsize::new(ENCODER_CACHE_SIZE).unwrap()));
        }

        if let Some(ref mut c) = *cache {
            if let Some(cached_factory) = c.get(model) {
                return cached_factory();
            }
            // Store factory in cache
            c.put(model.to_string(), factory);
        }
    }

    // Create encoder
    factory()
}

/// Count tokens in text
pub fn count_tokens(text: &str, model: &str) -> Result<usize> {
    let encoder = get_encoder(model)?;
    let tokens = encoder.encode_with_special_tokens(text);
    Ok(tokens.len())
}

/// Count tokens for a chat message (including message overhead)
pub fn count_message_tokens(role: &str, content: &str, model: &str) -> Result<usize> {
    let encoder = get_encoder(model)?;

    // OpenAI message format overhead
    // Every message follows <|start|>{role}\n{content}<|end|>\n
    let tokens_per_message = 4; // Base overhead
    let _tokens_per_name = 1;   // If name field is present

    let mut total = tokens_per_message;
    total += encoder.encode_with_special_tokens(role).len();
    total += encoder.encode_with_special_tokens(content).len();

    // Add tokens for assistant message prefix if needed
    if role == "assistant" {
        total += 2; // Additional overhead for assistant responses
    }

    Ok(total)
}

/// Truncate text to maximum token count
pub fn truncate_to_tokens(text: &str, max_tokens: usize, model: &str) -> Result<TruncateResult> {
    let encoder = get_encoder(model)?;
    let tokens = encoder.encode_with_special_tokens(text);
    let original_count = tokens.len();

    if original_count <= max_tokens {
        return Ok(TruncateResult {
            text: text.to_string(),
            original_count,
            truncated_count: original_count,
        });
    }

    // Truncate tokens
    let truncated = &tokens[..max_tokens];

    // Decode back to text
    let truncated_text = encoder.decode(truncated.to_vec())
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to decode tokens: {}", e)))?;

    Ok(TruncateResult {
        text: truncated_text,
        original_count,
        truncated_count: max_tokens,
    })
}

/// NAPI-exposed tokenizer functions
#[napi]
pub struct Tokenizer;

#[napi]
impl Tokenizer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self
    }

    /// Count tokens in text
    #[napi]
    pub fn count(&self, text: String, model: String) -> Result<u32> {
        count_tokens(&text, &model).map(|n| n as u32)
    }

    /// Count tokens for a message
    #[napi]
    pub fn count_message(&self, role: String, content: String, model: String) -> Result<u32> {
        count_message_tokens(&role, &content, &model).map(|n| n as u32)
    }

    /// Truncate text to max tokens
    #[napi]
    pub fn truncate(&self, text: String, max_tokens: u32, model: String) -> Result<String> {
        truncate_to_tokens(&text, max_tokens as usize, &model).map(|r| r.text)
    }
}

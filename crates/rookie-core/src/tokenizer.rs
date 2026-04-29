//! Tokenizer module using tiktoken-rs
//!
//! Provides accurate token counting for OpenAI models with LRU caching.
//! P4-T2: Accurate token counting with < 1% error.

use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Mutex;

// Cache size for encoders
const ENCODER_CACHE_SIZE: usize = 10;

/// Tokenizer result for truncation
#[derive(Clone, Debug)]
pub struct TruncateResult {
    pub text: String,
    pub original_count: usize,
    pub truncated_count: usize,
}

/// Global encoder cache - stores encoder factory functions instead of encoders
/// since CoreBPE doesn't implement Clone
static ENCODER_CACHE: Mutex<Option<LruCache<String, fn() -> anyhow::Result<tiktoken_rs::CoreBPE>>>> = Mutex::new(None);

/// Initialize the tokenizer cache
pub fn init_tokenizer() {
    let cache = LruCache::new(NonZeroUsize::new(ENCODER_CACHE_SIZE).unwrap());
    if let Ok(mut global_cache) = ENCODER_CACHE.lock() {
        *global_cache = Some(cache);
    }
}

/// Get or create an encoder for the specified model
fn get_encoder(model: &str) -> anyhow::Result<tiktoken_rs::CoreBPE> {
    // Map model to encoder factory
    let factory: fn() -> anyhow::Result<tiktoken_rs::CoreBPE> = match model {
        "cl100k_base" | "gpt-4" | "gpt-4-turbo" | "gpt-3.5-turbo" => {
            || tiktoken_rs::cl100k_base().map_err(|e| anyhow::anyhow!("Failed to load cl100k_base: {}", e))
        }
        "o200k_base" | "gpt-4o" | "gpt-4o-mini" => {
            || tiktoken_rs::o200k_base().map_err(|e| anyhow::anyhow!("Failed to load o200k_base: {}", e))
        }
        "p50k_base" | "text-davinci-003" | "text-davinci-002" => {
            || tiktoken_rs::p50k_base().map_err(|e| anyhow::anyhow!("Failed to load p50k_base: {}", e))
        }
        "p50k_edit" | "text-davinci-edit-001" | "code-davinci-edit-001" => {
            || tiktoken_rs::p50k_edit().map_err(|e| anyhow::anyhow!("Failed to load p50k_edit: {}", e))
        }
        "r50k_base" | "gpt2" => {
            || tiktoken_rs::r50k_base().map_err(|e| anyhow::anyhow!("Failed to load r50k_base: {}", e))
        }
        _ => {
            // Default to cl100k_base for unknown models
            || tiktoken_rs::cl100k_base().map_err(|e| anyhow::anyhow!("Failed to load default encoder: {}", e))
        }
    };

    // Try to get from cache first
    {
        let mut cache = ENCODER_CACHE
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock error: {}", e))?;

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
pub fn count_tokens(text: &str, model: &str) -> anyhow::Result<usize> {
    let encoder = get_encoder(model)?;
    let tokens = encoder.encode_with_special_tokens(text);
    Ok(tokens.len())
}

/// Count tokens for a chat message (including message overhead)
pub fn count_message_tokens(role: &str, content: &str, model: &str) -> anyhow::Result<usize> {
    let encoder = get_encoder(model)?;

    // OpenAI message format overhead
    // Every message follows <|start|>{role}\n{content}<|end|>\n
    let tokens_per_message = 4; // Base overhead

    let mut total = tokens_per_message;
    total += encoder.encode_with_special_tokens(role).len();
    total += encoder.encode_with_special_tokens(content).len();

    // Add tokens for assistant message prefix if needed
    if role == "assistant" {
        total += 2; // Additional overhead for assistant responses
    }

    Ok(total)
}

/// Count tokens for multiple messages
pub fn count_messages_tokens(messages: &[(String, String)], model: &str) -> anyhow::Result<usize> {
    let mut total = 0;
    for (role, content) in messages {
        total += count_message_tokens(role, content, model)?;
    }
    // Add tokens for priming
    total += 3;
    Ok(total)
}

/// Truncate text to maximum number of tokens
pub fn truncate_to_tokens(text: &str, max_tokens: usize, model: &str) -> anyhow::Result<TruncateResult> {
    let encoder = get_encoder(model)?;
    let tokens = encoder.encode_with_special_tokens(text);
    let original_count = tokens.len();

    if tokens.len() <= max_tokens {
        return Ok(TruncateResult {
            text: text.to_string(),
            original_count,
            truncated_count: original_count,
        });
    }

    // Truncate tokens
    let truncated = &tokens[..max_tokens];
    let decoded = encoder
        .decode(truncated.to_vec())
        .map_err(|e| anyhow::anyhow!("Decode error: {}", e))?;

    Ok(TruncateResult {
        text: decoded,
        original_count,
        truncated_count: max_tokens,
    })
}

/// Truncate text intelligently (keep beginning and end)
pub fn truncate_intelligently(
    text: &str,
    max_tokens: usize,
    model: &str,
) -> anyhow::Result<TruncateResult> {
    let encoder = get_encoder(model)?;
    let tokens = encoder.encode_with_special_tokens(text);
    let original_count = tokens.len();

    if tokens.len() <= max_tokens {
        return Ok(TruncateResult {
            text: text.to_string(),
            original_count,
            truncated_count: original_count,
        });
    }

    // Keep 40% from beginning and 40% from end
    let keep_tokens = (max_tokens as f64 * 0.8) as usize;
    let front_tokens = keep_tokens / 2;
    let back_tokens = keep_tokens - front_tokens;

    let front = &tokens[..front_tokens];
    let back = &tokens[tokens.len() - back_tokens..];

    let front_decoded = encoder
        .decode(front.to_vec())
        .map_err(|e| anyhow::anyhow!("Decode error: {}", e))?;
    let back_decoded = encoder
        .decode(back.to_vec())
        .map_err(|e| anyhow::anyhow!("Decode error: {}", e))?;

    let snipped_count = original_count - keep_tokens;
    let result_text = format!(
        "{}\n\n[... {} tokens snipped ...]\n\n{}",
        front_decoded, snipped_count, back_decoded
    );

    Ok(TruncateResult {
        text: result_text,
        original_count,
        truncated_count: keep_tokens,
    })
}

/// Batch count tokens for multiple texts
pub fn batch_count_tokens(texts: &[String], model: &str) -> anyhow::Result<Vec<usize>> {
    let encoder = get_encoder(model)?;

    let counts: Vec<usize> = texts
        .iter()
        .map(|text| encoder.encode_with_special_tokens(text).len())
        .collect();

    Ok(counts)
}

/// Get model information
pub fn get_model_info(model: &str) -> serde_json::Value {
    match model {
        "cl100k_base" | "gpt-4" | "gpt-4-turbo" | "gpt-3.5-turbo" => serde_json::json!({
            "encoding": "cl100k_base",
            "vocab_size": 100256,
            "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
            "pattern": "cl100k_base regex pattern",
        }),
        "o200k_base" | "gpt-4o" | "gpt-4o-mini" => serde_json::json!({
            "encoding": "o200k_base",
            "vocab_size": 200019,
            "models": ["gpt-4o", "gpt-4o-mini"],
            "pattern": "o200k_base regex pattern",
        }),
        "p50k_base" | "text-davinci-003" | "text-davinci-002" => serde_json::json!({
            "encoding": "p50k_base",
            "vocab_size": 50281,
            "models": ["text-davinci-003", "text-davinci-002"],
        }),
        _ => serde_json::json!({
            "encoding": "unknown",
            "error": "Unknown model, defaulting to cl100k_base"
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_tokens_simple() {
        let count = count_tokens("Hello world", "cl100k_base").unwrap();
        // "Hello world" should be around 2-3 tokens
        assert!(count > 0 && count < 10);
    }

    #[test]
    fn test_count_tokens_different_models() {
        let text = "Hello world";
        let cl100k = count_tokens(text, "cl100k_base").unwrap();
        let o200k = count_tokens(text, "o200k_base").unwrap();

        // Both should return valid counts
        assert!(cl100k > 0);
        assert!(o200k > 0);
    }

    #[test]
    fn test_truncate_to_tokens() {
        let text = "This is a longer text that should be truncated. ".repeat(20);
        let result = truncate_to_tokens(&text, 10, "cl100k_base").unwrap();

        assert!(result.original_count > 10);
        assert_eq!(result.truncated_count, 10);
        assert!(result.text.len() < text.len());
    }

    #[test]
    fn test_truncate_no_change_needed() {
        let text = "Short";
        let result = truncate_to_tokens(text, 100, "cl100k_base").unwrap();

        assert_eq!(result.original_count, result.truncated_count);
        assert_eq!(result.text, text);
    }

    #[test]
    fn test_batch_count() {
        let texts = vec![
            "Hello".to_string(),
            "World".to_string(),
            "Test".to_string(),
        ];
        let counts = batch_count_tokens(&texts, "cl100k_base").unwrap();

        assert_eq!(counts.len(), 3);
        assert!(counts.iter().all(|&c| c > 0));
    }

    #[test]
    fn test_message_tokens() {
        let count = count_message_tokens("user", "Hello", "cl100k_base").unwrap();
        // Should include overhead + role + content
        assert!(count >= 4);
    }

    #[test]
    fn test_model_info() {
        let info = get_model_info("cl100k_base");
        assert_eq!(info["encoding"], "cl100k_base");
        assert!(info["vocab_size"].as_u64().unwrap() > 0);
    }
}

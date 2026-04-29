//! Tokenizer tests for NAPI-RS bridge

use rookie_napi::tokenizer::*;

#[test]
fn test_init_tokenizer() {
    assert!(init_tokenizer().is_ok());
}

#[test]
fn test_count_tokens_simple() {
    init_tokenizer().unwrap();
    
    let count = count_tokens("Hello world", "cl100k_base").unwrap();
    assert!(count > 0);
    assert!(count < 10); // Should be 2-3 tokens
}

#[test]
fn test_count_tokens_different_models() {
    init_tokenizer().unwrap();
    
    let text = "Hello world, this is a test message.";
    let cl100k = count_tokens(text, "cl100k_base").unwrap();
    let o200k = count_tokens(text, "o200k_base").unwrap();
    
    // Both should return valid counts
    assert!(cl100k > 0);
    assert!(o200k > 0);
}

#[test]
fn test_truncate_to_tokens() {
    init_tokenizer().unwrap();
    
    let text = "This is a longer text that should be truncated when we set a low token limit. ".repeat(10);
    let result = truncate_to_tokens(&text, 10, "cl100k_base").unwrap();
    
    assert!(result.original_count > 10);
    assert_eq!(result.truncated_count, 10);
    assert!(result.text.len() < text.len());
}

#[test]
fn test_truncate_no_change_needed() {
    init_tokenizer().unwrap();
    
    let text = "Short";
    let result = truncate_to_tokens(text, 100, "cl100k_base").unwrap();
    
    assert_eq!(result.original_count, result.truncated_count);
    assert_eq!(result.text, text);
}

#[test]
fn test_batch_count_tokens() {
    init_tokenizer().unwrap();
    
    let texts = vec![
        "Hello".to_string(),
        "World".to_string(),
        "Test message".to_string(),
    ];
    let counts = batch_count_tokens(texts, Some("cl100k_base".to_string())).unwrap();
    
    assert_eq!(counts.len(), 3);
    assert!(counts.iter().all(|&c| c > 0));
}

#[test]
fn test_count_message_tokens() {
    init_tokenizer().unwrap();
    
    let count = count_message_tokens("user", "Hello, how are you?", "cl100k_base").unwrap();
    // Should include overhead + role + content
    assert!(count >= 4);
}

#[test]
fn test_get_model_info() {
    let info = get_model_info("cl100k_base".to_string()).unwrap();
    assert_eq!(info["encoding"], "cl100k_base");
    assert!(info["vocab_size"].as_u64().unwrap() > 0);
}

#[test]
fn test_tokenizer_accuracy() {
    init_tokenizer().unwrap();
    
    // Test known token counts for specific strings
    // "Hello" is typically 1 token in cl100k_base
    let hello_count = count_tokens("Hello", "cl100k_base").unwrap();
    assert!(hello_count >= 1 && hello_count <= 2);
    
    // Empty string should be 0
    let empty_count = count_tokens("", "cl100k_base").unwrap();
    assert_eq!(empty_count, 0);
}

//! Context Pipeline tests for NAPI-RS bridge

use rookie_napi::context::pipeline::*;
use rookie_napi::{PipelineConfig, PipelineMessage, PipelineStats};

fn create_test_message(role: &str, content: &str) -> PipelineMessage {
    PipelineMessage {
        role: role.to_string(),
        content: content.to_string(),
        tool_calls: None,
        tool_call_id: None,
        metadata: None,
    }
}

#[test]
fn test_empty_pipeline() {
    let messages = vec![];
    let config = PipelineConfig::default();
    let result = run_pipeline(messages, config).unwrap();
    assert_eq!(result.messages.len(), 0);
}

#[test]
fn test_single_message() {
    let messages = vec![create_test_message("user", "Hello world")];
    let config = PipelineConfig::default();
    let result = run_pipeline(messages, config).unwrap();
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].content, "Hello world");
}

#[test]
fn test_tool_budget_stage() {
    let long_content = "a".repeat(10000);
    let messages = vec![
        create_test_message("tool", &long_content),
    ];
    
    let config = PipelineConfig {
        max_tool_result_tokens: Some(100),
        ..Default::default()
    };
    
    let result = run_pipeline(messages, config).unwrap();
    assert_eq!(result.stats.stage1_tool_results, 1);
    assert!(result.messages[0].content.contains("truncated"));
}

#[test]
fn test_snip_stage() {
    let long_content = "a".repeat(20000);
    let messages = vec![
        create_test_message("assistant", &long_content),
    ];
    
    let config = PipelineConfig {
        snip_threshold: Some(1000),
        ..Default::default()
    };
    
    let result = run_pipeline(messages, config).unwrap();
    assert_eq!(result.stats.stage2_snipped, 1);
    assert!(result.messages[0].content.contains("snipped"));
}

#[test]
fn test_normalize_stage() {
    let messages = vec![
        create_test_message("user", "Line 1\n\n\n\nLine 2\twith tab"),
    ];
    
    let config = PipelineConfig::default();
    let result = run_pipeline(messages, config).unwrap();
    
    assert_eq!(result.stats.stage3_normalized, 1);
    assert!(!result.messages[0].content.contains("\n\n\n"));
    assert!(!result.messages[0].content.contains("\t"));
}

#[test]
fn test_collapse_stage() {
    let messages: Vec<_> = (0..20)
        .map(|i| create_test_message("user", &format!("Message {}", i)))
        .collect();
    
    let config = PipelineConfig {
        max_messages: Some(5),
        ..Default::default()
    };
    
    let result = run_pipeline(messages, config).unwrap();
    assert!(result.messages.len() <= 5);
    assert!(result.stats.stage4_collapsed > 0 || result.messages.iter().any(|m| m.content.contains("collapsed")));
}

#[test]
fn test_compact_stage() {
    // Create many long messages to trigger compaction
    let mut messages = vec![create_test_message("system", "You are helpful")];
    for i in 0..50 {
        messages.push(create_test_message("user", &"a".repeat(1000)));
        messages.push(create_test_message("assistant", &"b".repeat(1000)));
    }
    
    let config = PipelineConfig {
        context_window: Some(10000),
        compact_threshold: Some(0.5),
        ..Default::default()
    };
    
    let result = run_pipeline(messages, config).unwrap();
    assert!(result.stats.stage5_compacted > 0 || result.messages.iter().any(|m| m.content.contains("Autocompacted")));
}

#[test]
fn test_full_pipeline_stats() {
    let messages = vec![
        create_test_message("system", "You are helpful"),
        create_test_message("user", "Hello"),
        create_test_message("assistant", "Hi there"),
    ];
    
    let config = PipelineConfig::default();
    let result = run_pipeline(messages, config).unwrap();
    
    // Stats should be populated
    assert!(result.stats.total_tokens_before > 0);
    assert!(result.stats.total_tokens_after > 0);
}

#[test]
fn test_pipeline_preserves_system_messages() {
    let messages = vec![
        create_test_message("system", "System prompt 1"),
        create_test_message("system", "System prompt 2"),
        create_test_message("user", "Hello"),
    ];
    
    let config = PipelineConfig {
        max_messages: Some(2),
        ..Default::default()
    };
    
    let result = run_pipeline(messages, config).unwrap();
    
    // System messages should be preserved
    let system_count = result.messages.iter().filter(|m| m.role == "system").count();
    assert!(system_count >= 2);
}

#[test]
fn test_pipeline_message_roles_preserved() {
    let messages = vec![
        create_test_message("system", "System"),
        create_test_message("user", "User"),
        create_test_message("assistant", "Assistant"),
        create_test_message("tool", "Tool result"),
    ];
    
    let config = PipelineConfig::default();
    let result = run_pipeline(messages, config).unwrap();
    
    // All roles should be preserved
    let roles: Vec<_> = result.messages.iter().map(|m| m.role.clone()).collect();
    assert!(roles.contains(&"system".to_string()));
    assert!(roles.contains(&"user".to_string()));
    assert!(roles.contains(&"assistant".to_string()));
    assert!(roles.contains(&"tool".to_string()));
}

use rookie_core::hook::{HookDispatcher, HookEvent, HookConfig, HookContext, HookPriority, HookExecutionMode};

#[tokio::test]
async fn test_hook_dispatcher_creation() {
    let dispatcher = HookDispatcher::new();
    let stats = dispatcher.get_stats().await;
    
    assert_eq!(stats.total_hooks, 0);
    assert_eq!(stats.events_registered, 0);
}

#[tokio::test]
async fn test_hook_registration() {
    let dispatcher = HookDispatcher::new();
    
    let config = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo test".to_string()),
        priority: HookPriority::Normal,
        ..Default::default()
    };
    
    dispatcher.register(config).await;
    
    let hooks = dispatcher.get_hooks_for(HookEvent::PreToolUse).await;
    assert_eq!(hooks.len(), 1);
    
    let stats = dispatcher.get_stats().await;
    assert_eq!(stats.total_hooks, 1);
}

#[tokio::test]
async fn test_priority_queue() {
    let dispatcher = HookDispatcher::new();
    
    // Register hooks with different priorities
    let low_priority = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo low".to_string()),
        priority: HookPriority::Low,
        ..Default::default()
    };
    
    let high_priority = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo high".to_string()),
        priority: HookPriority::High,
        ..Default::default()
    };
    
    dispatcher.register(low_priority).await;
    dispatcher.register(high_priority).await;
    
    let hooks = dispatcher.get_hooks_for(HookEvent::PreToolUse).await;
    assert_eq!(hooks.len(), 2);
    // High priority should come first
    assert_eq!(hooks[0].priority, HookPriority::High);
    assert_eq!(hooks[1].priority, HookPriority::Low);
}

#[tokio::test]
async fn test_hook_fire() {
    let dispatcher = HookDispatcher::new();
    
    let config = HookConfig {
        event: HookEvent::SessionStart,
        command: Some("echo 'session started'".to_string()),
        ..Default::default()
    };
    
    dispatcher.register(config).await;
    
    let context = HookContext {
        session_id: "test-session".to_string(),
        project_root: "/tmp".to_string(),
        ..Default::default()
    };
    
    let results = dispatcher.fire(HookEvent::SessionStart, &context).await;
    
    // Should have one result
    assert_eq!(results.len(), 1);
    // The command should succeed
    assert!(results[0].success);
}

#[tokio::test]
async fn test_hook_chain() {
    let dispatcher = HookDispatcher::new();
    
    // Register two transform hooks
    let config1 = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo 'first'".to_string()),
        can_modify_input: true,
        ..Default::default()
    };
    
    let config2 = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo 'second'".to_string()),
        can_modify_input: true,
        ..Default::default()
    };
    
    dispatcher.register(config1).await;
    dispatcher.register(config2).await;
    
    let context = HookContext {
        session_id: "test-session".to_string(),
        project_root: "/tmp".to_string(),
        tool_name: Some("test_tool".to_string()),
        tool_input: Some(serde_json::json!({"key": "value"})),
        ..Default::default()
    };
    
    let result = dispatcher.fire_chain(HookEvent::PreToolUse, &context).await;
    
    assert_eq!(result.results.len(), 2);
    assert!(!result.rejected);
}

#[tokio::test]
async fn test_async_hook() {
    let dispatcher = HookDispatcher::new();
    
    let config = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("sleep 0.1 && echo done".to_string()),
        mode: HookExecutionMode::AsyncRewake,
        ..Default::default()
    };
    
    dispatcher.register(config).await;
    
    let context = HookContext {
        session_id: "test-session".to_string(),
        project_root: "/tmp".to_string(),
        ..Default::default()
    };
    
    let results = dispatcher.fire(HookEvent::PreToolUse, &context).await;
    
    assert_eq!(results.len(), 1);
    assert!(results[0].async_token.is_some());
    
    // Check pending async hooks
    assert!(dispatcher.has_pending_async().await);
    
    // Wait for async hooks
    let async_results = dispatcher.await_async_hooks(5000).await;
    assert!(!dispatcher.has_pending_async().await);
}

#[tokio::test]
async fn test_dedup() {
    let dispatcher = HookDispatcher::new();
    
    let config = HookConfig {
        event: HookEvent::PreToolUse,
        command: Some("echo test".to_string()),
        dedup: true,
        ..Default::default()
    };
    
    dispatcher.register(config).await;
    
    let context = HookContext {
        session_id: "test-session".to_string(),
        project_root: "/tmp".to_string(),
        tool_name: Some("test_tool".to_string()),
        tool_input: Some(serde_json::json!({"key": "value"})),
        ..Default::default()
    };
    
    // Fire twice with same context
    let results1 = dispatcher.fire(HookEvent::PreToolUse, &context).await;
    let results2 = dispatcher.fire(HookEvent::PreToolUse, &context).await;
    
    assert_eq!(results1.len(), 1);
    assert_eq!(results2.len(), 1);
    // Second should be marked as skipped due to dedup
    assert!(results2[0].skipped.unwrap_or(false));
}

#[tokio::test]
async fn test_all_12_event_types() {
    let dispatcher = HookDispatcher::new();
    
    let events = vec![
        HookEvent::PreToolUse,
        HookEvent::PostToolUse,
        HookEvent::OnToolError,
        HookEvent::SessionStart,
        HookEvent::SessionEnd,
        HookEvent::UserPromptSubmit,
        HookEvent::Stop,
        HookEvent::PreCheckpoint,
        HookEvent::PostCheckpoint,
        HookEvent::PreCompact,
        HookEvent::PostCompact,
        HookEvent::OnPermissionAsk,
    ];
    
    for event in events {
        let config = HookConfig {
            event,
            command: Some(format!("echo {:?}", event)),
            ..Default::default()
        };
        dispatcher.register(config).await;
    }
    
    let stats = dispatcher.get_stats().await;
    assert_eq!(stats.total_hooks, 12);
    assert_eq!(stats.events_registered, 12);
}

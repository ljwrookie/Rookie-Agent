use rookie_core::permission::{PermissionEngine, PermissionRule, PermissionAction, PermissionSource, PermissionCheckRequest};

#[tokio::test]
async fn test_permission_engine_creation() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    let summary = engine.get_rules_summary().await;
    assert!(summary.contains_key(&PermissionSource::Default));
}

#[tokio::test]
async fn test_default_rules() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Check default allow rules
    let read_result = engine.check(&PermissionCheckRequest {
        tool: "file_read".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    assert_eq!(read_result.action, PermissionAction::Allow);
    
    // Check default ask rules
    let write_result = engine.check(&PermissionCheckRequest {
        tool: "file_write".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    assert_eq!(write_result.action, PermissionAction::Ask);
}

#[tokio::test]
async fn test_add_rule() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    let rule = PermissionRule {
        tool: "custom_tool".to_string(),
        action: PermissionAction::Allow,
        args: None,
        source: Some(PermissionSource::Project),
        glob_pattern: None,
        command_pattern: None,
    };
    
    engine.add_rule(rule, PermissionSource::Project).await;
    
    let result = engine.check(&PermissionCheckRequest {
        tool: "custom_tool".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    assert_eq!(result.action, PermissionAction::Allow);
}

#[tokio::test]
async fn test_session_rules() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Add a session rule
    let rule = PermissionRule {
        tool: "test_tool".to_string(),
        action: PermissionAction::Deny,
        args: None,
        source: Some(PermissionSource::Session),
        glob_pattern: None,
        command_pattern: None,
    };
    
    engine.add_session_rule(rule).await;
    
    let result = engine.check(&PermissionCheckRequest {
        tool: "test_tool".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    assert_eq!(result.action, PermissionAction::Deny);
    
    // Clear session rules
    engine.clear_session_rules().await;
    
    let result_after = engine.check(&PermissionCheckRequest {
        tool: "test_tool".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    // Should fall back to default (ask)
    assert_eq!(result_after.action, PermissionAction::Ask);
}

#[tokio::test]
async fn test_priority_ordering() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Add a project rule that denies
    let project_rule = PermissionRule {
        tool: "priority_test".to_string(),
        action: PermissionAction::Deny,
        args: None,
        source: Some(PermissionSource::Project),
        glob_pattern: None,
        command_pattern: None,
    };
    
    engine.add_rule(project_rule, PermissionSource::Project).await;
    
    // Add a CLI arg rule that allows (higher priority)
    let cli_rule = PermissionRule {
        tool: "priority_test".to_string(),
        action: PermissionAction::Allow,
        args: None,
        source: Some(PermissionSource::CliArg),
        glob_pattern: None,
        command_pattern: None,
    };
    
    engine.add_rule(cli_rule, PermissionSource::CliArg).await;
    
    let result = engine.check(&PermissionCheckRequest {
        tool: "priority_test".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    // CLI arg should win due to higher priority
    assert_eq!(result.action, PermissionAction::Allow);
    assert_eq!(result.source, PermissionSource::CliArg);
}

#[tokio::test]
async fn test_glob_matching() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Add rule with glob pattern
    let rule = PermissionRule {
        tool: "file_*".to_string(),
        action: PermissionAction::Allow,
        args: None,
        source: Some(PermissionSource::Project),
        glob_pattern: None,
        command_pattern: None,
    };
    
    engine.add_rule(rule, PermissionSource::Project).await;
    
    let file_read = engine.check(&PermissionCheckRequest {
        tool: "file_read".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    let file_write = engine.check(&PermissionCheckRequest {
        tool: "file_write".to_string(),
        params: None,
        command: None,
        path: None,
    }).await;
    
    assert_eq!(file_read.action, PermissionAction::Allow);
    assert_eq!(file_write.action, PermissionAction::Allow);
}

#[tokio::test]
async fn test_path_filtering() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Configure path blacklist
    let config = rookie_core::permission::PermissionEngineConfig {
        path_blacklist: vec!["/etc/*".to_string(), "/root/*".to_string()],
        ..Default::default()
    };
    
    engine.set_config(config).await;
    
    let blocked = engine.check(&PermissionCheckRequest {
        tool: "file_read".to_string(),
        params: None,
        command: None,
        path: Some("/etc/passwd".to_string()),
    }).await;
    
    assert!(!blocked.allowed);
    
    let allowed = engine.check(&PermissionCheckRequest {
        tool: "file_read".to_string(),
        params: None,
        command: None,
        path: Some("/home/user/file.txt".to_string()),
    }).await;
    
    assert!(allowed.allowed);
}

#[tokio::test]
async fn test_command_filtering() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Configure command blacklist
    let config = rookie_core::permission::PermissionEngineConfig {
        command_blacklist: vec![
            rookie_core::permission::CommandFilter {
                pattern: "rm -rf /".to_string(),
                action: rookie_core::permission::FilterAction::Deny,
                description: Some("Dangerous command".to_string()),
            }
        ],
        ..Default::default()
    };
    
    engine.set_config(config).await;
    
    let blocked = engine.check(&PermissionCheckRequest {
        tool: "shell_execute".to_string(),
        params: None,
        command: Some("rm -rf /".to_string()),
        path: None,
    }).await;
    
    assert!(!blocked.allowed);
}

#[tokio::test]
async fn test_denial_tracking() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    // Initially no denials
    let stats = engine.get_denial_stats().await;
    assert_eq!(stats.consecutive, 0);
    assert_eq!(stats.total, 0);
    
    // Simulate denials
    for _ in 0..3 {
        let error = engine.increment_denials().await;
        if error.is_some() {
            break;
        }
    }
    
    let stats_after = engine.get_denial_stats().await;
    assert_eq!(stats_after.consecutive, 3);
    assert_eq!(stats_after.total, 3);
    
    // Reset consecutive
    engine.reset_consecutive_denials().await;
    
    let stats_reset = engine.get_denial_stats().await;
    assert_eq!(stats_reset.consecutive, 0);
    assert_eq!(stats_reset.total, 3); // Total remains
}

#[tokio::test]
async fn test_effective_rule() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    let effective = engine.get_effective_rule("file_read").await;
    
    assert!(effective.is_some());
    let (rule, source) = effective.unwrap();
    assert_eq!(rule.tool, "file_read");
    assert_eq!(rule.action, PermissionAction::Allow);
    assert_eq!(source, PermissionSource::Default);
}

#[tokio::test]
async fn test_all_8_sources() {
    let engine = PermissionEngine::new();
    engine.initialize().await;
    
    let summary = engine.get_rules_summary().await;
    
    // Check all 8 sources are present
    assert!(summary.contains_key(&PermissionSource::CliArg));
    assert!(summary.contains_key(&PermissionSource::FlagSettings));
    assert!(summary.contains_key(&PermissionSource::PolicySettings));
    assert!(summary.contains_key(&PermissionSource::Managed));
    assert!(summary.contains_key(&PermissionSource::Project));
    assert!(summary.contains_key(&PermissionSource::User));
    assert!(summary.contains_key(&PermissionSource::Session));
    assert!(summary.contains_key(&PermissionSource::Default));
}

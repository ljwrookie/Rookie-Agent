use crate::permission::types::*;
use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Permission engine with rule-based access control
#[derive(Debug)]
pub struct PermissionEngine {
    /// Rules organized by source
    rules_by_source: RwLock<HashMap<PermissionSource, Vec<PermissionRule>>>,
    /// Engine configuration
    config: RwLock<PermissionEngineConfig>,
    /// Compiled glob patterns for path matching
    path_whitelist: RwLock<Option<GlobSet>>,
    path_blacklist: RwLock<Option<GlobSet>>,
    /// Compiled command patterns
    command_whitelist_regex: RwLock<Vec<Regex>>,
    command_blacklist_regex: RwLock<Vec<Regex>>,
    /// Denial tracking
    consecutive_denials: RwLock<u32>,
    total_denials: RwLock<u32>,
    /// Persist handlers
    persist_handlers: RwLock<Vec<Box<dyn Fn(PermissionRule, RememberScope) + Send + Sync>>>,
}

impl PermissionEngine {
    pub fn new() -> Self {
        let engine = Self {
            rules_by_source: RwLock::new(HashMap::new()),
            config: RwLock::new(PermissionEngineConfig::default()),
            path_whitelist: RwLock::new(None),
            path_blacklist: RwLock::new(None),
            command_whitelist_regex: RwLock::new(Vec::new()),
            command_blacklist_regex: RwLock::new(Vec::new()),
            consecutive_denials: RwLock::new(0),
            total_denials: RwLock::new(0),
            persist_handlers: RwLock::new(Vec::new()),
        };

        // Initialize default rules
        tokio::spawn(async move {
            // This would be called after creation
        });

        engine
    }

    pub fn with_config(config: PermissionEngineConfig) -> Self {
        let engine = Self::new();
        
        // Initialize with config
        let rt = tokio::runtime::Handle::try_current();
        if let Ok(rt) = rt {
            let config_clone = config.clone();
            rt.spawn(async move {
                // Config will be set when initialize is called
            });
        }

        engine
    }

    /// Initialize the engine with default rules
    pub async fn initialize(&self) {
        let mut rules = self.rules_by_source.write().await;
        
        // Initialize all source buckets
        for source in [
            PermissionSource::CliArg,
            PermissionSource::FlagSettings,
            PermissionSource::PolicySettings,
            PermissionSource::Managed,
            PermissionSource::Project,
            PermissionSource::User,
            PermissionSource::Session,
            PermissionSource::Default,
        ] {
            rules.entry(source).or_insert_with(Vec::new);
        }

        // Set default rules (lowest priority)
        rules.insert(PermissionSource::Default, vec![
            PermissionRule {
                tool: "file_read".to_string(),
                action: PermissionAction::Allow,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "search_code".to_string(),
                action: PermissionAction::Allow,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "git_status".to_string(),
                action: PermissionAction::Allow,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "git_diff".to_string(),
                action: PermissionAction::Allow,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "file_write".to_string(),
                action: PermissionAction::Ask,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "file_edit".to_string(),
                action: PermissionAction::Ask,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
            PermissionRule {
                tool: "shell_execute".to_string(),
                action: PermissionAction::Ask,
                args: None,
                source: Some(PermissionSource::Default),
                glob_pattern: None,
                command_pattern: None,
            },
        ]);

        drop(rules);
        
        // Compile patterns
        self.compile_patterns().await;
        
        info!("Permission engine initialized with default rules");
    }

    /// Add a rule to a specific source
    pub async fn add_rule(&self, rule: PermissionRule, source: PermissionSource) {
        let mut rules = self.rules_by_source.write().await;
        let source_rules = rules.entry(source).or_insert_with(Vec::new);
        source_rules.push(rule);
        drop(rules);
        
        debug!("Added rule to source {:?}", source);
    }

    /// Add a session rule (temporary, in-memory only)
    pub async fn add_session_rule(&self, rule: PermissionRule) {
        let mut rules = self.rules_by_source.write().await;
        let session_rules = rules.entry(PermissionSource::Session).or_insert_with(Vec::new);
        
        // De-dup: replace matching rule
        let key = format!("{}::{}", rule.tool, rule.args.as_deref().unwrap_or(""));
        session_rules.retain(|r| {
            let r_key = format!("{}::{}", r.tool, r.args.as_deref().unwrap_or(""));
            r_key != key
        });
        
        session_rules.push(PermissionRule {
            source: Some(PermissionSource::Session),
            ..rule
        });
        
        drop(rules);
    }

    /// Clear all session rules
    pub async fn clear_session_rules(&self) {
        let mut rules = self.rules_by_source.write().await;
        rules.insert(PermissionSource::Session, Vec::new());
    }

    /// Load rules from settings
    pub async fn load_from_settings(&self, settings: &serde_json::Value, source: PermissionSource) {
        if let Some(permissions) = settings.get("permissions") {
            if let Some(perm_array) = permissions.as_array() {
                for perm in perm_array {
                    if let Ok(rule) = serde_json::from_value::<PermissionRule>(perm.clone()) {
                        self.add_rule(rule, source).await;
                    }
                }
            }
        }
    }

    /// Load rules from CLI arguments
    pub async fn load_from_cli_args(&self, allow: Vec<String>, deny: Vec<String>) {
        for tool in allow {
            self.add_rule(PermissionRule {
                tool,
                action: PermissionAction::Allow,
                args: None,
                source: Some(PermissionSource::CliArg),
                glob_pattern: None,
                command_pattern: None,
            }, PermissionSource::CliArg).await;
        }

        for tool in deny {
            self.add_rule(PermissionRule {
                tool,
                action: PermissionAction::Deny,
                args: None,
                source: Some(PermissionSource::CliArg),
                glob_pattern: None,
                command_pattern: None,
            }, PermissionSource::CliArg).await;
        }
    }

    /// Check permission for a tool
    pub async fn check(&self, request: &PermissionCheckRequest) -> PermissionCheckResult {
        // Check denial limits first
        if let Some(error_code) = self.check_denial_limits().await {
            return PermissionCheckResult {
                allowed: false,
                action: PermissionAction::Deny,
                source: PermissionSource::Default,
                rule: None,
                reason: Some(format!("Denial limit reached: {:?}", error_code)),
                resource_limits: None,
            };
        }

        // Check resource limits
        if let Some(limits) = self.check_resource_limits(request).await {
            return PermissionCheckResult {
                allowed: false,
                action: PermissionAction::Deny,
                source: PermissionSource::Default,
                rule: None,
                reason: Some(format!("Resource limit exceeded: {:?}", limits)),
                resource_limits: Some(limits),
            };
        }

        // Check command filters
        if let Some(ref command) = request.command {
            if let Some(filter_result) = self.check_command_filter(command).await {
                return filter_result;
            }
        }

        // Check path filters
        if let Some(ref path) = request.path {
            if let Some(filter_result) = self.check_path_filter(path).await {
                return filter_result;
            }
        }

        // Check rules by priority
        let rules = self.rules_by_source.read().await;
        let mut sorted_sources: Vec<_> = rules.iter().collect();
        sorted_sources.sort_by_key(|(source, _)| source.priority());

        for (source, source_rules) in sorted_sources {
            for rule in source_rules {
                if self.matches_rule(rule, request) {
                    return PermissionCheckResult {
                        allowed: matches!(rule.action, PermissionAction::Allow),
                        action: rule.action,
                        source: *source,
                        rule: Some(rule.clone()),
                        reason: None,
                        resource_limits: None,
                    };
                }
            }
        }

        // Default: ask
        PermissionCheckResult {
            allowed: false,
            action: PermissionAction::Ask,
            source: PermissionSource::Default,
            rule: None,
            reason: None,
            resource_limits: None,
        }
    }

    /// Get effective rule for a tool (for debugging)
    pub async fn get_effective_rule(&self, tool: &str) -> Option<(PermissionRule, PermissionSource)> {
        let rules = self.rules_by_source.read().await;
        let mut sorted_sources: Vec<_> = rules.iter().collect();
        sorted_sources.sort_by_key(|(source, _)| source.priority());

        for (source, source_rules) in sorted_sources {
            for rule in source_rules {
                if self.matches_tool_pattern(&rule.tool, tool) {
                    return Some((rule.clone(), *source));
                }
            }
        }

        None
    }

    /// Apply user decision from ask prompt
    pub async fn apply_ask_decision(&self, tool: &str, decision: &AskDecision, params: Option<serde_json::Value>) -> Result<(), PermissionErrorCode> {
        if !decision.allowed {
            // Track denials
            let error_code = self.increment_denials().await;
            if error_code.is_some() {
                return Err(error_code.unwrap());
            }
        } else {
            // Reset consecutive denials on allow
            self.reset_consecutive_denials().await;
        }

        match decision.remember {
            RememberScope::Once => {
                // No persistence needed
            }
            RememberScope::Session => {
                let rule = PermissionRule {
                    tool: tool.to_string(),
                    action: if decision.allowed { PermissionAction::Allow } else { PermissionAction::Deny },
                    args: params.as_ref().map(|p| p.to_string()),
                    source: Some(PermissionSource::Session),
                    glob_pattern: None,
                    command_pattern: None,
                };
                self.add_session_rule(rule).await;
            }
            RememberScope::Forever => {
                let rule = PermissionRule {
                    tool: tool.to_string(),
                    action: if decision.allowed { PermissionAction::Allow } else { PermissionAction::Deny },
                    args: params.as_ref().map(|p| p.to_string()),
                    source: Some(PermissionSource::User),
                    glob_pattern: None,
                    command_pattern: None,
                };
                self.add_rule(rule, PermissionSource::User).await;
                
                // Notify persist handlers
                let handlers = self.persist_handlers.read().await;
                for handler in handlers.iter() {
                    handler(rule.clone(), RememberScope::Forever);
                }
            }
        }

        Ok(())
    }

    /// Get denial statistics
    pub async fn get_denial_stats(&self) -> DenialStats {
        DenialStats {
            consecutive: *self.consecutive_denials.read().await,
            total: *self.total_denials.read().await,
        }
    }

    /// Reset consecutive denials
    pub async fn reset_consecutive_denials(&self) {
        let mut denials = self.consecutive_denials.write().await;
        *denials = 0;
    }

    /// Increment denials and check limits
    pub async fn increment_denials(&self) -> Option<PermissionErrorCode> {
        let mut consecutive = self.consecutive_denials.write().await;
        let mut total = self.total_denials.write().await;
        let config = self.config.read().await;
        
        *consecutive += 1;
        *total += 1;
        
        if *consecutive >= config.denial_tracking.max_consecutive_denials {
            return Some(PermissionErrorCode::MaxConsecutiveDenialsReached);
        }
        if *total >= config.denial_tracking.max_total_denials {
            return Some(PermissionErrorCode::MaxTotalDenialsReached);
        }
        
        None
    }

    /// Check denial limits
    pub async fn check_denial_limits(&self) -> Option<PermissionErrorCode> {
        let consecutive = *self.consecutive_denials.read().await;
        let total = *self.total_denials.read().await;
        let config = self.config.read().await;
        
        if consecutive >= config.denial_tracking.max_consecutive_denials {
            return Some(PermissionErrorCode::MaxConsecutiveDenialsReached);
        }
        if total >= config.denial_tracking.max_total_denials {
            return Some(PermissionErrorCode::MaxTotalDenialsReached);
        }
        
        None
    }

    /// Get rules summary by source
    pub async fn get_rules_summary(&self) -> HashMap<PermissionSource, usize> {
        let rules = self.rules_by_source.read().await;
        rules.iter().map(|(k, v)| (*k, v.len())).collect()
    }

    /// Register persist handler
    pub async fn on_persist<F>(&self, handler: F)
    where
        F: Fn(PermissionRule, RememberScope) + Send + Sync + 'static,
    {
        let mut handlers = self.persist_handlers.write().await;
        handlers.push(Box::new(handler));
    }

    /// Update configuration
    pub async fn set_config(&self, config: PermissionEngineConfig) {
        let mut cfg = self.config.write().await;
        *cfg = config;
        drop(cfg);
        
        // Recompile patterns
        self.compile_patterns().await;
    }

    /// Compile glob and regex patterns
    async fn compile_patterns(&self) {
        let config = self.config.read().await;
        
        // Compile path patterns
        if !config.path_whitelist.is_empty() {
            let mut builder = GlobSetBuilder::new();
            for pattern in &config.path_whitelist {
                if let Ok(glob) = Glob::new(pattern) {
                    builder.add(glob);
                }
            }
            let mut whitelist = self.path_whitelist.write().await;
            *whitelist = builder.build().ok();
        }
        
        if !config.path_blacklist.is_empty() {
            let mut builder = GlobSetBuilder::new();
            for pattern in &config.path_blacklist {
                if let Ok(glob) = Glob::new(pattern) {
                    builder.add(glob);
                }
            }
            let mut blacklist = self.path_blacklist.write().await;
            *blacklist = builder.build().ok();
        }
        
        // Compile command patterns
        let mut whitelist_regex = self.command_whitelist_regex.write().await;
        whitelist_regex.clear();
        for filter in &config.command_whitelist {
            if let Ok(regex) = Regex::new(&filter.pattern) {
                whitelist_regex.push(regex);
            }
        }
        
        let mut blacklist_regex = self.command_blacklist_regex.write().await;
        blacklist_regex.clear();
        for filter in &config.command_blacklist {
            if let Ok(regex) = Regex::new(&filter.pattern) {
                blacklist_regex.push(regex);
            }
        }
    }

    /// Check if a rule matches a request
    fn matches_rule(&self, rule: &PermissionRule, request: &PermissionCheckRequest) -> bool {
        // Check tool pattern
        if !self.matches_tool_pattern(&rule.tool, &request.tool) {
            return false;
        }
        
        // Check args pattern if specified
        if let Some(ref args_pattern) = rule.args {
            if let Some(ref params) = request.params {
                let params_str = params.to_string();
                if !params_str.contains(args_pattern) {
                    return false;
                }
            }
        }
        
        // Check glob pattern if specified
        if let Some(ref glob) = rule.glob_pattern {
            if let Some(ref path) = request.path {
                if let Ok(pattern) = Glob::new(glob) {
                    if !pattern.compile_matcher().is_match(path) {
                        return false;
                    }
                }
            }
        }
        
        // Check command pattern if specified
        if let Some(ref cmd_pattern) = rule.command_pattern {
            if let Some(ref command) = request.command {
                if let Ok(regex) = Regex::new(cmd_pattern) {
                    if !regex.is_match(command) {
                        return false;
                    }
                }
            }
        }
        
        true
    }

    /// Match tool pattern (supports glob)
    fn matches_tool_pattern(&self, pattern: &str, tool: &str) -> bool {
        if pattern == tool {
            return true;
        }
        
        // Simple glob matching
        if pattern.contains('*') {
            let regex_pattern = pattern.replace("*", ".*");
            if let Ok(regex) = Regex::new(&format!("^{}$", regex_pattern)) {
                return regex.is_match(tool);
            }
        }
        
        false
    }

    /// Check command against filters
    async fn check_command_filter(&self, command: &str) -> Option<PermissionCheckResult> {
        // Check blacklist first
        let blacklist = self.command_blacklist_regex.read().await;
        for regex in blacklist.iter() {
            if regex.is_match(command) {
                return Some(PermissionCheckResult {
                    allowed: false,
                    action: PermissionAction::Deny,
                    source: PermissionSource::Default,
                    rule: None,
                    reason: Some("Command matches blacklist pattern".to_string()),
                    resource_limits: None,
                });
            }
        }
        drop(blacklist);
        
        // Check whitelist if not empty
        let whitelist = self.command_whitelist_regex.read().await;
        if !whitelist.is_empty() {
            let mut allowed = false;
            for regex in whitelist.iter() {
                if regex.is_match(command) {
                    allowed = true;
                    break;
                }
            }
            if !allowed {
                return Some(PermissionCheckResult {
                    allowed: false,
                    action: PermissionAction::Deny,
                    source: PermissionSource::Default,
                    rule: None,
                    reason: Some("Command not in whitelist".to_string()),
                    resource_limits: None,
                });
            }
        }
        
        None
    }

    /// Check path against filters
    async fn check_path_filter(&self, path: &str) -> Option<PermissionCheckResult> {
        // Check blacklist first
        let blacklist = self.path_blacklist.read().await;
        if let Some(ref set) = *blacklist {
            if set.is_match(path) {
                return Some(PermissionCheckResult {
                    allowed: false,
                    action: PermissionAction::Deny,
                    source: PermissionSource::Default,
                    rule: None,
                    reason: Some("Path matches blacklist pattern".to_string()),
                    resource_limits: None,
                });
            }
        }
        drop(blacklist);
        
        // Check whitelist if not empty
        let whitelist = self.path_whitelist.read().await;
        if let Some(ref set) = *whitelist {
            if !set.is_match(path) {
                return Some(PermissionCheckResult {
                    allowed: false,
                    action: PermissionAction::Deny,
                    source: PermissionSource::Default,
                    rule: None,
                    reason: Some("Path not in whitelist".to_string()),
                    resource_limits: None,
                });
            }
        }
        
        None
    }

    /// Check resource limits
    async fn check_resource_limits(&self, _request: &PermissionCheckRequest) -> Option<ResourceLimits> {
        // This would integrate with actual resource monitoring
        // For now, return None (no limits exceeded)
        None
    }
}

impl Default for PermissionEngine {
    fn default() -> Self {
        Self::new()
    }
}

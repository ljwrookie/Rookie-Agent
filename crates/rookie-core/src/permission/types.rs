use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Permission action types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionAction {
    Allow,
    Ask,
    Deny,
}

impl Default for PermissionAction {
    fn default() -> Self {
        PermissionAction::Ask
    }
}

/// Permission source types - 8-source overlay system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionSource {
    CliArg,
    FlagSettings,
    PolicySettings,
    Managed,
    Project,
    User,
    Session,
    Default,
}

impl PermissionSource {
    pub fn priority(&self) -> i32 {
        match self {
            PermissionSource::CliArg => 1,
            PermissionSource::FlagSettings => 2,
            PermissionSource::PolicySettings => 3,
            PermissionSource::Managed => 4,
            PermissionSource::Project => 5,
            PermissionSource::User => 6,
            PermissionSource::Session => 7,
            PermissionSource::Default => 8,
        }
    }
}

/// Permission rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub tool: String,
    pub action: PermissionAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PermissionSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glob_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_pattern: Option<String>,
}

/// Resource limits for permission enforcement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cpu_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_network_requests_per_minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_file_size_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_execution_time_secs: Option<u64>,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_cpu_percent: None,
            max_memory_mb: None,
            max_network_requests_per_minute: None,
            max_file_size_mb: None,
            max_execution_time_secs: Some(300), // 5 minutes default
        }
    }
}

/// Command whitelist/blacklist entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandFilter {
    pub pattern: String,
    pub action: FilterAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterAction {
    Allow,
    Deny,
    RequireApproval,
}

/// Permission check request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionCheckRequest {
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Permission check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionCheckResult {
    pub allowed: bool,
    pub action: PermissionAction,
    pub source: PermissionSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<PermissionRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_limits: Option<ResourceLimits>,
}

/// Denial tracking configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenialTrackingConfig {
    pub max_consecutive_denials: u32,
    pub max_total_denials: u32,
}

impl Default for DenialTrackingConfig {
    fn default() -> Self {
        Self {
            max_consecutive_denials: 3,
            max_total_denials: 20,
        }
    }
}

/// Denial statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenialStats {
    pub consecutive: u32,
    pub total: u32,
}

/// Permission error codes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PermissionErrorCode {
    MaxConsecutiveDenialsReached,
    MaxTotalDenialsReached,
    ResourceLimitExceeded,
    CommandBlocked,
    PathBlocked,
    InvalidRule,
}

/// Permission engine configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionEngineConfig {
    #[serde(default)]
    pub denial_tracking: DenialTrackingConfig,
    #[serde(default)]
    pub resource_limits: ResourceLimits,
    #[serde(default)]
    pub command_whitelist: Vec<CommandFilter>,
    #[serde(default)]
    pub command_blacklist: Vec<CommandFilter>,
    #[serde(default)]
    pub path_whitelist: Vec<String>,
    #[serde(default)]
    pub path_blacklist: Vec<String>,
}

impl Default for PermissionEngineConfig {
    fn default() -> Self {
        Self {
            denial_tracking: DenialTrackingConfig::default(),
            resource_limits: ResourceLimits::default(),
            command_whitelist: Vec::new(),
            command_blacklist: Vec::new(),
            path_whitelist: Vec::new(),
            path_blacklist: Vec::new(),
        }
    }
}

/// Remember scope for permission decisions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RememberScope {
    Once,
    Session,
    Forever,
}

/// Ask decision from user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskDecision {
    pub allowed: bool,
    #[serde(default)]
    pub remember: RememberScope,
}

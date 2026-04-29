use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Hook event types - 12 total events
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HookEvent {
    PreToolUse,
    PostToolUse,
    OnToolError,
    SessionStart,
    SessionEnd,
    UserPromptSubmit,
    Stop,
    PreCheckpoint,
    PostCheckpoint,
    PreCompact,
    PostCompact,
    OnPermissionAsk,
}

impl HookEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            HookEvent::PreToolUse => "PreToolUse",
            HookEvent::PostToolUse => "PostToolUse",
            HookEvent::OnToolError => "OnToolError",
            HookEvent::SessionStart => "SessionStart",
            HookEvent::SessionEnd => "SessionEnd",
            HookEvent::UserPromptSubmit => "UserPromptSubmit",
            HookEvent::Stop => "Stop",
            HookEvent::PreCheckpoint => "PreCheckpoint",
            HookEvent::PostCheckpoint => "PostCheckpoint",
            HookEvent::PreCompact => "PreCompact",
            HookEvent::PostCompact => "PostCompact",
            HookEvent::OnPermissionAsk => "OnPermissionAsk",
        }
    }
}

/// Hook priority levels - higher value = higher priority
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookPriority {
    Critical,
    High,
    Normal,
    Low,
    Background,
}

impl HookPriority {
    pub fn value(&self) -> i32 {
        match self {
            HookPriority::Critical => 100,
            HookPriority::High => 75,
            HookPriority::Normal => 50,
            HookPriority::Low => 25,
            HookPriority::Background => 0,
        }
    }
}

impl Default for HookPriority {
    fn default() -> Self {
        HookPriority::Normal
    }
}

/// Trust level for hook execution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookTrustLevel {
    Trusted,
    Untrusted,
    Verified,
}

impl Default for HookTrustLevel {
    fn default() -> Self {
        HookTrustLevel::Untrusted
    }
}

/// Hook execution mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HookExecutionMode {
    Blocking,
    NonBlocking,
    AsyncRewake,
}

impl Default for HookExecutionMode {
    fn default() -> Self {
        HookExecutionMode::Blocking
    }
}

/// Hook configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookConfig {
    pub event: HookEvent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub retries: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub blocking: bool,
    #[serde(default)]
    pub can_reject: bool,
    #[serde(default)]
    pub priority: HookPriority,
    #[serde(default)]
    pub trust_level: HookTrustLevel,
    #[serde(default)]
    pub mode: HookExecutionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    #[serde(default)]
    pub can_modify_input: bool,
    #[serde(default)]
    pub skip_if_rejected: bool,
    #[serde(default = "default_true")]
    pub structured_output: bool,
    #[serde(default = "default_true")]
    pub dedup: bool,
}

fn default_timeout() -> u64 {
    30000
}

fn default_true() -> bool {
    true
}

impl Default for HookConfig {
    fn default() -> Self {
        Self {
            event: HookEvent::PreToolUse,
            matcher: None,
            command: None,
            url: None,
            method: None,
            headers: None,
            retries: 0,
            prompt: None,
            model: None,
            timeout: default_timeout(),
            blocking: true,
            can_reject: false,
            priority: HookPriority::Normal,
            trust_level: HookTrustLevel::Untrusted,
            mode: HookExecutionMode::Blocking,
            condition: None,
            can_modify_input: false,
            skip_if_rejected: false,
            structured_output: true,
            dedup: true,
        }
    }
}

/// Hook context passed to hooks
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HookContext {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<String>,
    pub project_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_decision: Option<TrustDecision>,
}

/// Trust decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDecision {
    pub trusted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Hook execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    pub hook_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejected: Option<bool>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub async_token: Option<String>,
}

/// Chain result from multiple hooks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookChainResult {
    pub results: Vec<HookResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_input: Option<serde_json::Value>,
    pub rejected: bool,
    pub total_duration_ms: u64,
}

/// Pending async hook for rewake mechanism
#[derive(Debug)]
pub struct PendingAsyncHook {
    pub token: String,
    pub hook: HookConfig,
    pub context: HookContext,
    pub start_time: std::time::Instant,
}

/// LLM decision for structured output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookLLMDecision {
    pub decision: String, // "allow" or "reject"
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_input: Option<HashMap<String, serde_json::Value>>,
}

use crate::hook::types::*;
use std::collections::{BinaryHeap, HashMap};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{timeout, Duration};
use tracing::{debug, error, info, warn};

/// Priority queue entry for hooks
#[derive(Debug, Clone)]
struct PriorityEntry {
    priority: i32,
    sequence: usize,
    hook: HookConfig,
}

impl PartialEq for PriorityEntry {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.sequence == other.sequence
    }
}

impl Eq for PriorityEntry {}

impl PartialOrd for PriorityEntry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PriorityEntry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Higher priority first, then by sequence (FIFO for same priority)
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| self.sequence.cmp(&other.sequence))
    }
}

/// Dedup cache entry
#[derive(Debug, Clone)]
struct DedupEntry {
    timestamp: std::time::Instant,
    result: HookResult,
}

/// Hook dispatcher with priority queue, chain execution, and async support
#[derive(Debug)]
pub struct HookDispatcher {
    /// Hooks organized by event type
    hooks: RwLock<HashMap<HookEvent, Vec<HookConfig>>>,
    /// Pending async hooks for rewake mechanism
    pending_async: Mutex<HashMap<String, PendingAsyncHook>>,
    /// Async hook results
    async_results: Mutex<HashMap<String, HookResult>>,
    /// Dedup cache
    dedup_cache: Mutex<HashMap<String, DedupEntry>>,
    /// Sequence counter for FIFO ordering within same priority
    sequence_counter: Mutex<usize>,
    /// Default timeout for hooks
    default_timeout: Duration,
    /// Dedup window
    dedup_window: Duration,
}

impl HookDispatcher {
    pub fn new() -> Self {
        Self {
            hooks: RwLock::new(HashMap::new()),
            pending_async: Mutex::new(HashMap::new()),
            async_results: Mutex::new(HashMap::new()),
            dedup_cache: Mutex::new(HashMap::new()),
            sequence_counter: Mutex::new(0),
            default_timeout: Duration::from_millis(30000),
            dedup_window: Duration::from_millis(500),
        }
    }

    pub fn with_timeout(default_timeout_ms: u64) -> Self {
        Self {
            hooks: RwLock::new(HashMap::new()),
            pending_async: Mutex::new(HashMap::new()),
            async_results: Mutex::new(HashMap::new()),
            dedup_cache: Mutex::new(HashMap::new()),
            sequence_counter: Mutex::new(0),
            default_timeout: Duration::from_millis(default_timeout_ms),
            dedup_window: Duration::from_millis(500),
        }
    }

    /// Register a hook configuration
    pub async fn register(&self, config: HookConfig) {
        let mut hooks = self.hooks.write().await;
        let entries = hooks.entry(config.event).or_insert_with(Vec::new);
        entries.push(config);
        // Sort by priority (higher first)
        entries.sort_by_key(|h| -h.priority.value());
        debug!("Registered hook for event {:?}, total hooks: {}", entries[0].event, entries.len());
    }

    /// Register multiple hooks
    pub async fn register_batch(&self, configs: Vec<HookConfig>) {
        for config in configs {
            self.register(config).await;
        }
    }

    /// Load hooks from settings
    pub async fn load_from_settings(&self, settings: &serde_json::Value) {
        if let Some(hooks_value) = settings.get("hooks") {
            if let Some(hooks_map) = hooks_value.as_object() {
                for (event_name, configs) in hooks_map {
                    if let Ok(event) = parse_hook_event(event_name) {
                        if let Some(config_array) = configs.as_array() {
                            for config_value in config_array {
                                let mut config: HookConfig = match serde_json::from_value(config_value.clone()) {
                                    Ok(c) => c,
                                    Err(e) => {
                                        warn!("Failed to parse hook config: {}", e);
                                        continue;
                                    }
                                };
                                config.event = event;
                                self.register(config).await;
                            }
                        }
                    }
                }
            }
        }
    }

    /// Fire hooks for an event with priority queue execution
    pub async fn fire(&self, event: HookEvent, context: &HookContext) -> Vec<HookResult> {
        let hooks = self.hooks.read().await;
        let configs = match hooks.get(&event) {
            Some(c) => c.clone(),
            None => return Vec::new(),
        };
        drop(hooks);

        // Build priority queue
        let mut queue = BinaryHeap::new();
        let mut seq = self.sequence_counter.lock().await;
        for hook in configs {
            // Check matcher for tool events
            if let Some(ref matcher) = hook.matcher {
                if let Some(ref tool_name) = context.tool_name {
                    if !glob_matches(matcher, tool_name) {
                        continue;
                    }
                }
            }

            // Check condition
            if let Some(ref condition) = hook.condition {
                if !evaluate_condition(condition, context) {
                    continue;
                }
            }

            *seq += 1;
            queue.push(PriorityEntry {
                priority: hook.priority.value(),
                sequence: *seq,
                hook,
            });
        }
        drop(seq);

        // Execute hooks in priority order
        let mut results = Vec::new();
        let mut any_rejected = false;

        while let Some(entry) = queue.pop() {
            let hook = entry.hook;

            // Skip if previous hook rejected and this hook has skip_if_rejected
            if any_rejected && hook.skip_if_rejected {
                results.push(HookResult {
                    hook_id: format!("{:?}_{}", hook.event, entry.sequence),
                    success: true,
                    output: Some("skipped: previous hook rejected".to_string()),
                    rejected: None,
                    duration_ms: 0,
                    modified_input: None,
                    skipped: Some(true),
                    skip_reason: Some("previous hook rejected".to_string()),
                    async_token: None,
                });
                continue;
            }

            // Check dedup
            if hook.dedup {
                let dedup_key = generate_dedup_key(&hook, context);
                let cache = self.dedup_cache.lock().await;
                if let Some(entry) = cache.get(&dedup_key) {
                    if entry.timestamp.elapsed() < self.dedup_window {
                        let mut cached_result = entry.result.clone();
                        cached_result.skipped = Some(true);
                        cached_result.skip_reason = Some("deduplicated".to_string());
                        results.push(cached_result);
                        continue;
                    }
                }
                drop(cache);
            }

            let result = match hook.mode {
                HookExecutionMode::Blocking => {
                    self.execute_hook(&hook, context).await
                }
                HookExecutionMode::NonBlocking => {
                    // Fire and forget
                    let hook_clone = hook.clone();
                    let context_clone = context.clone();
                    let dispatcher = Arc::new(self);
                    tokio::spawn(async move {
                        let _ = dispatcher.execute_hook(&hook_clone, &context_clone).await;
                    });
                    HookResult {
                        hook_id: format!("{:?}_{}", hook.event, entry.sequence),
                        success: true,
                        output: Some("non-blocking hook dispatched".to_string()),
                        rejected: None,
                        duration_ms: 0,
                        modified_input: None,
                        skipped: None,
                        skip_reason: None,
                        async_token: None,
                    }
                }
                HookExecutionMode::AsyncRewake => {
                    self.dispatch_async_hook(&hook, context).await
                }
            };

            if result.rejected == Some(true) {
                any_rejected = true;
            }

            // Cache result for dedup
            if hook.dedup && result.success {
                let dedup_key = generate_dedup_key(&hook, context);
                let mut cache = self.dedup_cache.lock().await;
                cache.insert(dedup_key, DedupEntry {
                    timestamp: std::time::Instant::now(),
                    result: result.clone(),
                });
            }

            results.push(result);
        }

        results
    }

    /// Fire hooks in a chain, passing modified input from one to the next
    pub async fn fire_chain(&self, event: HookEvent, initial_context: &HookContext) -> HookChainResult {
        let hooks = self.hooks.read().await;
        let configs = match hooks.get(&event) {
            Some(c) => c.clone(),
            None => {
                return HookChainResult {
                    results: Vec::new(),
                    final_input: initial_context.modified_input.clone(),
                    rejected: false,
                    total_duration_ms: 0,
                }
            }
        };
        drop(hooks);

        let start = std::time::Instant::now();
        let mut results = Vec::new();
        let mut current_context = initial_context.clone();
        let mut any_rejected = false;
        let mut seq = self.sequence_counter.lock().await;

        for hook in configs {
            // Check matcher
            if let Some(ref matcher) = hook.matcher {
                if let Some(ref tool_name) = current_context.tool_name {
                    if !glob_matches(matcher, tool_name) {
                        continue;
                    }
                }
            }

            // Check condition
            if let Some(ref condition) = hook.condition {
                if !evaluate_condition(condition, &current_context) {
                    continue;
                }
            }

            *seq += 1;
            let hook_id = format!("{:?}_{}", hook.event, *seq);
            let hook_start = std::time::Instant::now();

            let result = self.execute_hook_with_context(&hook, &current_context).await;
            let duration_ms = hook_start.elapsed().as_millis() as u64;

            // Update context with modified input for next hook
            if let Some(ref modified) = result.modified_input {
                current_context.modified_input = Some(modified.clone());
            }

            if result.rejected == Some(true) {
                any_rejected = true;
            }

            results.push(HookResult {
                hook_id,
                success: result.success,
                output: result.output,
                rejected: result.rejected,
                duration_ms,
                modified_input: result.modified_input,
                skipped: result.skipped,
                skip_reason: result.skip_reason,
                async_token: None,
            });

            // Stop chain if rejected and hook can reject
            if any_rejected && hook.can_reject {
                break;
            }
        }

        drop(seq);

        HookChainResult {
            results,
            final_input: current_context.modified_input,
            rejected: any_rejected,
            total_duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    /// Execute a single hook
    async fn execute_hook(&self, hook: &HookConfig, context: &HookContext) -> HookResult {
        let start = std::time::Instant::now();
        let hook_id = format!("{:?}_{}", hook.event, start.elapsed().as_nanos());

        // Check trust level
        if let Some(ref trust) = context.trust_decision {
            if matches!(hook.trust_level, HookTrustLevel::Trusted) && !trust.trusted {
                return HookResult {
                    hook_id,
                    success: true,
                    output: Some("skipped: trust level insufficient".to_string()),
                    rejected: None,
                    duration_ms: start.elapsed().as_millis() as u64,
                    modified_input: None,
                    skipped: Some(true),
                    skip_reason: Some("trust level insufficient".to_string()),
                    async_token: None,
                };
            }
        }

        let timeout_duration = Duration::from_millis(hook.timeout);

        let result = match timeout(timeout_duration, self.run_hook_impl(hook, context)).await {
            Ok(Ok(output)) => HookResult {
                hook_id: hook_id.clone(),
                success: true,
                output: Some(output),
                rejected: None,
                duration_ms: start.elapsed().as_millis() as u64,
                modified_input: None,
                skipped: None,
                skip_reason: None,
                async_token: None,
            },
            Ok(Err(e)) => HookResult {
                hook_id: hook_id.clone(),
                success: false,
                output: Some(format!("Error: {}", e)),
                rejected: if hook.can_reject { Some(true) } else { None },
                duration_ms: start.elapsed().as_millis() as u64,
                modified_input: None,
                skipped: None,
                skip_reason: None,
                async_token: None,
            },
            Err(_) => HookResult {
                hook_id: hook_id.clone(),
                success: false,
                output: Some(format!("Timeout after {}ms", hook.timeout)),
                rejected: if hook.can_reject { Some(true) } else { None },
                duration_ms: start.elapsed().as_millis() as u64,
                modified_input: None,
                skipped: None,
                skip_reason: None,
                async_token: None,
            },
        };

        result
    }

    /// Execute hook with context modification support
    async fn execute_hook_with_context(&self, hook: &HookConfig, context: &HookContext) -> HookResult {
        self.execute_hook(hook, context).await
    }

    /// Dispatch async hook and return token
    async fn dispatch_async_hook(&self, hook: &HookConfig, context: &HookContext) -> HookResult {
        let token = generate_async_token();
        let start = std::time::Instant::now();

        let pending = PendingAsyncHook {
            token: token.clone(),
            hook: hook.clone(),
            context: context.clone(),
            start_time: start,
        };

        {
            let mut pending_map = self.pending_async.lock().await;
            pending_map.insert(token.clone(), pending);
        }

        // Start execution in background
        let dispatcher = Arc::new(self);
        let hook_clone = hook.clone();
        let context_clone = context.clone();
        let token_clone = token.clone();

        tokio::spawn(async move {
            let result = dispatcher.execute_hook(&hook_clone, &context_clone).await;
            let mut async_results = dispatcher.async_results.lock().await;
            async_results.insert(token_clone, result);
        });

        HookResult {
            hook_id: format!("{:?}_async", hook.event),
            success: true,
            output: Some(format!("async hook dispatched, token: {}", token)),
            rejected: None,
            duration_ms: 0,
            modified_input: None,
            skipped: None,
            skip_reason: None,
            async_token: Some(token),
        }
    }

    /// Rewake an async hook with a result
    pub async fn rewake(&self, token: &str, result: HookResult) -> Result<(), String> {
        let mut pending_map = self.pending_async.lock().await;
        
        if pending_map.remove(token).is_none() {
            return Err(format!("No pending async hook found for token: {}", token));
        }
        drop(pending_map);

        let mut async_results = self.async_results.lock().await;
        async_results.insert(token.to_string(), result);
        
        Ok(())
    }

    /// Check if there are pending async hooks
    pub async fn has_pending_async(&self) -> bool {
        let pending = self.pending_async.lock().await;
        !pending.is_empty()
    }

    /// Get all pending async tokens
    pub async fn get_pending_tokens(&self) -> Vec<String> {
        let pending = self.pending_async.lock().await;
        pending.keys().cloned().collect()
    }

    /// Wait for all pending async hooks to complete
    pub async fn await_async_hooks(&self, timeout_ms: u64) -> Vec<HookResult> {
        let timeout_duration = Duration::from_millis(timeout_ms);
        let start = std::time::Instant::now();

        loop {
            let pending = self.pending_async.lock().await;
            if pending.is_empty() {
                let results = self.async_results.lock().await;
                return results.values().cloned().collect();
            }
            drop(pending);

            if start.elapsed() > timeout_duration {
                warn!("Timeout waiting for async hooks");
                break;
            }

            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let results = self.async_results.lock().await;
        results.values().cloned().collect()
    }

    /// Get hooks for a specific event
    pub async fn get_hooks_for(&self, event: HookEvent) -> Vec<HookConfig> {
        let hooks = self.hooks.read().await;
        hooks.get(&event).cloned().unwrap_or_default()
    }

    /// Clear all hooks
    pub async fn clear(&self) {
        let mut hooks = self.hooks.write().await;
        hooks.clear();
    }

    /// Get statistics
    pub async fn get_stats(&self) -> HookDispatcherStats {
        let hooks = self.hooks.read().await;
        let pending = self.pending_async.lock().await;
        let cache = self.dedup_cache.lock().await;

        HookDispatcherStats {
            total_hooks: hooks.values().map(|v| v.len()).sum(),
            events_registered: hooks.len(),
            pending_async_hooks: pending.len(),
            dedup_cache_size: cache.len(),
        }
    }

    /// Core hook execution implementation
    async fn run_hook_impl(&self, hook: &HookConfig, context: &HookContext) -> Result<String, String> {
        if let Some(ref command) = hook.command {
            self.run_shell_hook(command, context, hook.timeout).await
        } else if let Some(ref url) = hook.url {
            self.run_http_hook(url, hook, context).await
        } else if let Some(ref prompt) = hook.prompt {
            self.run_prompt_hook(prompt, hook, context).await
        } else {
            Err("Hook has no command/url/prompt configured".to_string())
        }
    }

    /// Run shell command hook
    async fn run_shell_hook(&self, command: &str, context: &HookContext, timeout_ms: u64) -> Result<String, String> {
        use std::process::Stdio;
        use tokio::process::Command;

        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(command)
            .current_dir(&context.project_root)
            .env("ROOKIE_SESSION_ID", &context.session_id)
            .env("ROOKIE_PROJECT_ROOT", &context.project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref tool_name) = context.tool_name {
            cmd.env("ROOKIE_TOOL_NAME", tool_name);
        }
        if let Some(ref tool_output) = context.tool_output {
            cmd.env("ROOKIE_TOOL_OUTPUT", tool_output);
        }

        let timeout_duration = Duration::from_millis(timeout_ms);

        match timeout(timeout_duration, cmd.output()).await {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                
                if output.status.success() {
                    Ok(stdout)
                } else {
                    Err(format!("Command failed: {}", stderr))
                }
            }
            Ok(Err(e)) => Err(format!("Failed to execute command: {}", e)),
            Err(_) => Err(format!("Command timeout after {}ms", timeout_ms)),
        }
    }

    /// Run HTTP webhook hook
    async fn run_http_hook(&self, url: &str, hook: &HookConfig, context: &HookContext) -> Result<String, String> {
        let client = reqwest::Client::new();
        let method = hook.method.as_deref().unwrap_or("POST");
        
        let mut request = match method.to_uppercase().as_str() {
            "GET" => client.get(url),
            "PUT" => client.put(url),
            "PATCH" => client.patch(url),
            "DELETE" => client.delete(url),
            _ => client.post(url),
        };

        // Add headers
        request = request.header("content-type", "application/json");
        if let Some(ref headers) = hook.headers {
            for (key, value) in headers {
                request = request.header(key, value);
            }
        }

        let body = serde_json::json!({
            "event": hook.event.as_str(),
            "context": context,
        });

        let timeout_duration = Duration::from_millis(hook.timeout);

        match timeout(timeout_duration, request.json(&body).send()).await {
            Ok(Ok(response)) => {
                let status = response.status();
                match response.text().await {
                    Ok(text) => {
                        if status.is_success() {
                            Ok(text)
                        } else {
                            Err(format!("HTTP {}: {}", status, text))
                        }
                    }
                    Err(e) => Err(format!("Failed to read response: {}", e)),
                }
            }
            Ok(Err(e)) => Err(format!("HTTP request failed: {}", e)),
            Err(_) => Err(format!("HTTP timeout after {}ms", hook.timeout)),
        }
    }

    /// Run LLM prompt hook (placeholder - actual LLM integration would be in TS layer)
    async fn run_prompt_hook(&self, prompt: &str, hook: &HookConfig, _context: &HookContext) -> Result<String, String> {
        // This is a placeholder - actual prompt execution would delegate to TS layer
        // or use a Rust-based LLM client
        Ok(format!("Prompt hook: {} (structured_output: {})", 
            prompt.chars().take(50).collect::<String>(),
            hook.structured_output))
    }
}

impl Default for HookDispatcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics for the hook dispatcher
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDispatcherStats {
    pub total_hooks: usize,
    pub events_registered: usize,
    pub pending_async_hooks: usize,
    pub dedup_cache_size: usize,
}

/// Parse hook event from string
fn parse_hook_event(s: &str) -> Result<HookEvent, String> {
    match s {
        "PreToolUse" => Ok(HookEvent::PreToolUse),
        "PostToolUse" => Ok(HookEvent::PostToolUse),
        "OnToolError" => Ok(HookEvent::OnToolError),
        "SessionStart" => Ok(HookEvent::SessionStart),
        "SessionEnd" => Ok(HookEvent::SessionEnd),
        "UserPromptSubmit" => Ok(HookEvent::UserPromptSubmit),
        "Stop" => Ok(HookEvent::Stop),
        "PreCheckpoint" => Ok(HookEvent::PreCheckpoint),
        "PostCheckpoint" => Ok(HookEvent::PostCheckpoint),
        "PreCompact" => Ok(HookEvent::PreCompact),
        "PostCompact" => Ok(HookEvent::PostCompact),
        "OnPermissionAsk" => Ok(HookEvent::OnPermissionAsk),
        _ => Err(format!("Unknown hook event: {}", s)),
    }
}

/// Simple glob matching
fn glob_matches(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.contains('*') {
        let regex_pattern = pattern.replace("*", ".*");
        if let Ok(regex) = regex::Regex::new(&format!("^{}$", regex_pattern)) {
            return regex.is_match(text);
        }
    }
    pattern == text
}

/// Evaluate condition expression
fn evaluate_condition(condition: &str, context: &HookContext) -> bool {
    // Simple condition evaluation
    // Supports: toolName == 'xxx', event == 'xxx', sessionId == 'xxx'
    
    let condition = condition.trim();
    
    // Handle simple equality checks
    if let Some(caps) = regex::Regex::new(r"(\w+)\s*==\s*['\"]([^'\"]+)['\"]").unwrap().captures(condition) {
        let field = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let value = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        
        match field {
            "toolName" => context.tool_name.as_ref().map(|t| t == value).unwrap_or(false),
            "sessionId" => context.session_id == value,
            _ => true, // Unknown field, allow
        }
    } else {
        // Default: allow
        true
    }
}

/// Generate dedup key for a hook
fn generate_dedup_key(hook: &HookConfig, context: &HookContext) -> String {
    format!(
        "{:?}:{}:{}",
        hook.event,
        hook.matcher.as_deref().unwrap_or("*"),
        context.tool_input.as_ref().map(|i| i.to_string()).unwrap_or_default()
    )
}

/// Generate unique async token
fn generate_async_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::SeqCst);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    
    format!("async_{}_{}", timestamp, count)
}

use serde::Serialize;

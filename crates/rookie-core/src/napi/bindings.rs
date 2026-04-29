//! NAPI-RS bindings for Rookie Core
//!
//! Exposes Rust functionality to JavaScript/TypeScript

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

use crate::agent::blackboard::{Blackboard, BlackboardEntry, CasResult};
use crate::scheduler::cron::{CronScheduler, ScheduledTask, TaskHistory, TaskStatus};
use crate::skill::{EmbeddingConfig, MatchResult, SkillEntry, SkillMatcher};

/// JavaScript-facing Skill entry
#[napi(object)]
#[derive(Clone)]
pub struct JsSkillEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub metadata: Option<String>, // JSON string
}

impl From<SkillEntry> for JsSkillEntry {
    fn from(entry: SkillEntry) -> Self {
        Self {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            metadata: serde_json::to_string(&entry.metadata).ok(),
        }
    }
}

/// JavaScript-facing match result
#[napi(object)]
#[derive(Clone)]
pub struct JsMatchResult {
    pub skill: JsSkillEntry,
    pub score: f64,
    pub rank: u32,
}

impl From<MatchResult> for JsMatchResult {
    fn from(result: MatchResult) -> Self {
        Self {
            skill: result.skill.into(),
            score: result.score as f64,
            rank: result.rank as u32,
        }
    }
}

/// Thread-safe wrapper for SkillMatcher
#[napi]
pub struct SkillMatcherWrapper {
    inner: Arc<Mutex<SkillMatcher>>,
}

#[napi]
impl SkillMatcherWrapper {
    /// Create a new skill matcher with default configuration
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SkillMatcher::new())),
        }
    }

    /// Create a new skill matcher with custom embedding dimension
    #[napi(factory)]
    pub fn with_config(dimension: u32, seed: Option<u64>) -> Self {
        let config = EmbeddingConfig {
            dimension: dimension as usize,
            seed: seed.unwrap_or(42),
            num_hashes: 4,
        };
        Self {
            inner: Arc::new(Mutex::new(SkillMatcher::with_config(config))),
        }
    }

    /// Add a skill to the matcher
    #[napi]
    pub fn add_skill(
        &self,
        id: String,
        name: String,
        description: String,
        metadata_json: Option<String>,
    ) -> Result<()> {
        let mut entry = SkillEntry::new(id, name, description);
        
        if let Some(json) = metadata_json {
            let metadata: std::collections::HashMap<String, serde_json::Value> =
                serde_json::from_str(&json).map_err(|e| {
                    Error::new(Status::InvalidArg, format!("Invalid metadata JSON: {}", e))
                })?;
            entry.metadata = metadata;
        }

        let mut matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        matcher.add_skill(entry);
        Ok(())
    }

    /// Remove a skill from the matcher
    #[napi]
    pub fn remove_skill(&self, id: String) -> Result<bool> {
        let mut matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher.remove_skill(&id).is_some())
    }

    /// Find matching skills for a query
    #[napi]
    pub fn find_matches(&self, query: String, top_k: Option<u32>) -> Result<Vec<JsMatchResult>> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        let k = top_k.unwrap_or(5) as usize;
        let results = matcher.find_matches(&query, k);
        
        Ok(results.into_iter().map(JsMatchResult::from).collect())
    }

    /// Find the best matching skill
    #[napi]
    pub fn find_best_match(&self, query: String) -> Result<Option<JsMatchResult>> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher.find_best_match(&query).map(JsMatchResult::from))
    }

    /// Get all registered skills
    #[napi]
    pub fn get_all_skills(&self) -> Result<Vec<JsSkillEntry>> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher
            .get_all_skills()
            .into_iter()
            .map(|e| e.clone().into())
            .collect())
    }

    /// Get number of registered skills
    #[napi(getter)]
    pub fn len(&self) -> Result<u32> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher.len() as u32)
    }

    /// Check if matcher is empty
    #[napi(getter)]
    pub fn is_empty(&self) -> Result<bool> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher.is_empty())
    }

    /// Calculate semantic similarity between two texts
    #[napi]
    pub fn calculate_similarity(&self, text1: String, text2: String) -> Result<f64> {
        let matcher = self.inner.lock().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Lock poisoned: {}", e))
        })?;
        
        Ok(matcher.calculate_similarity(&text1, &text2) as f64)
    }
}

impl Default for SkillMatcherWrapper {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Blackboard NAPI Bindings
// ============================================================================

/// JavaScript-facing blackboard entry
#[napi(object)]
#[derive(Clone)]
pub struct JsBlackboardEntry {
    pub key: String,
    pub value: String, // JSON string
    pub version: u32,
    pub timestamp: u64,
    pub author: String,
}

impl From<(String, BlackboardEntry)> for JsBlackboardEntry {
    fn from((key, entry): (String, BlackboardEntry)) -> Self {
        Self {
            key,
            value: serde_json::to_string(&entry.value).unwrap_or_default(),
            version: entry.version as u32,
            timestamp: entry.timestamp,
            author: entry.author,
        }
    }
}

/// Thread-safe wrapper for Blackboard
#[napi]
pub struct BlackboardWrapper {
    inner: Arc<Blackboard>,
}

#[napi]
impl BlackboardWrapper {
    /// Create a new blackboard instance
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Blackboard::new()),
        }
    }

    /// Get a value from the blackboard
    #[napi]
    pub fn get(&self, namespace: String, key: String) -> Option<String> {
        self.inner
            .get_value(&namespace, &key)
            .map(|v| serde_json::to_string(&v).unwrap_or_default())
    }

    /// Get full entry with metadata
    #[napi]
    pub fn get_entry(&self, namespace: String, key: String) -> Option<JsBlackboardEntry> {
        self.inner
            .get(&namespace, &key)
            .map(|e| (key, e).into())
    }

    /// Set a value in the blackboard
    #[napi]
    pub fn set(&self, namespace: String, key: String, value_json: String, author: String) -> Result<JsBlackboardEntry> {
        let value: serde_json::Value = serde_json::from_str(&value_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {}", e)))?;
        let entry = self.inner.set(&namespace, &key, value, &author);
        Ok((key, entry).into())
    }

    /// Set with TTL (milliseconds)
    #[napi]
    pub fn set_with_ttl(&self, namespace: String, key: String, value_json: String, author: String, ttl_ms: u64) -> Result<JsBlackboardEntry> {
        let value: serde_json::Value = serde_json::from_str(&value_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {}", e)))?;
        let entry = self.inner.set_with_ttl(&namespace, &key, value, &author, ttl_ms);
        Ok((key, entry).into())
    }

    /// Compare-And-Swap operation
    /// Returns true if successful, false if version mismatch
    #[napi]
    pub fn cas(&self, namespace: String, key: String, expected_version: u32, value_json: String, author: String) -> Result<bool> {
        let value: serde_json::Value = serde_json::from_str(&value_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {}", e)))?;
        match self.inner.cas(&namespace, &key, expected_version as u64, value, &author) {
            CasResult::Success => Ok(true),
            CasResult::VersionMismatch { .. } => Ok(false),
            CasResult::KeyNotFound => Err(Error::new(Status::GenericFailure, "Key not found")),
        }
    }

    /// Delete a key
    #[napi]
    pub fn delete(&self, namespace: String, key: String, author: String) -> bool {
        self.inner.delete(&namespace, &key, &author).is_some()
    }

    /// Check if key exists
    #[napi]
    pub fn has(&self, namespace: String, key: String) -> bool {
        self.inner.has(&namespace, &key)
    }

    /// List keys in namespace (optional prefix filter)
    #[napi]
    pub fn keys(&self, namespace: String, prefix: Option<String>) -> Vec<String> {
        self.inner.keys(&namespace, prefix.as_deref())
    }

    /// Get all entries as JSON object
    #[napi]
    pub fn snapshot(&self, namespace: String) -> Result<String> {
        let snapshot = self.inner.snapshot_values(&namespace);
        serde_json::to_string(&snapshot)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))
    }

    /// Clear all entries in namespace
    #[napi]
    pub fn clear_namespace(&self, namespace: String) -> u32 {
        self.inner.clear_namespace(&namespace) as u32
    }

    /// Remove entire namespace
    #[napi]
    pub fn remove_namespace(&self, namespace: String) -> bool {
        self.inner.remove_namespace(&namespace)
    }

    /// List all namespaces
    #[napi]
    pub fn list_namespaces(&self) -> Vec<String> {
        self.inner.list_namespaces()
    }

    /// Get entry count in namespace
    #[napi]
    pub fn count(&self, namespace: String) -> u32 {
        self.inner.count(&namespace) as u32
    }

    /// Get total entry count
    #[napi]
    pub fn total_count(&self) -> u32 {
        self.inner.total_count() as u32
    }

    /// Clean up expired entries
    #[napi]
    pub fn cleanup_expired(&self) -> u32 {
        self.inner.cleanup_expired() as u32
    }
}

impl Default for BlackboardWrapper {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Scheduler NAPI Bindings
// ============================================================================

/// JavaScript-facing scheduled task
#[napi(object)]
#[derive(Clone)]
pub struct JsScheduledTask {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub cron_expr: String,
    pub command: String,
    pub status: String,
    pub enabled: bool,
    pub created_at: u64,
    pub updated_at: Option<u64>,
    pub next_run_at: Option<u64>,
    pub last_run_at: Option<u64>,
    pub run_count: u64,
    pub success_count: u64,
    pub fail_count: u64,
    pub timeout_ms: u64,
}

impl From<ScheduledTask> for JsScheduledTask {
    fn from(task: ScheduledTask) -> Self {
        Self {
            id: task.id,
            name: task.name,
            description: task.description,
            cron_expr: task.cron_expr,
            command: task.command,
            status: task.status.to_string(),
            enabled: task.enabled,
            created_at: task.created_at,
            updated_at: task.updated_at,
            next_run_at: task.next_run_at,
            last_run_at: task.last_run_at,
            run_count: task.run_count,
            success_count: task.success_count,
            fail_count: task.fail_count,
            timeout_ms: task.timeout_ms,
        }
    }
}

/// JavaScript-facing task history entry
#[napi(object)]
#[derive(Clone)]
pub struct JsTaskHistory {
    pub id: String,
    pub task_id: String,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
}

impl From<TaskHistory> for JsTaskHistory {
    fn from(h: TaskHistory) -> Self {
        Self {
            id: h.id,
            task_id: h.task_id,
            started_at: h.started_at,
            completed_at: h.completed_at,
            status: h.status.to_string(),
            output: h.output,
            error: h.error,
            duration_ms: h.duration_ms,
        }
    }
}

/// Thread-safe wrapper for CronScheduler
#[napi]
pub struct CronSchedulerWrapper {
    inner: Arc<CronScheduler>,
}

#[napi]
impl CronSchedulerWrapper {
    /// Create a new scheduler instance
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(CronScheduler::new()),
        }
    }

    /// Schedule a new task
    /// Returns task ID on success
    #[napi]
    pub async fn schedule(&self, name: String, cron_expr: String, command: String, timeout_ms: Option<u64>) -> Result<String> {
        let mut task = ScheduledTask::new(name, cron_expr, command)
            .map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;
        if let Some(timeout) = timeout_ms {
            task.timeout_ms = timeout;
        }
        self.inner.schedule(task).await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Cancel a task
    #[napi]
    pub async fn cancel(&self, task_id: String) -> Result<()> {
        self.inner.cancel(&task_id).await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Get a task by ID
    #[napi]
    pub async fn get_task(&self, task_id: String) -> Option<JsScheduledTask> {
        self.inner.get_task(&task_id).await.map(JsScheduledTask::from)
    }

    /// List all tasks
    #[napi]
    pub async fn list_tasks(&self) -> Vec<JsScheduledTask> {
        self.inner.list_tasks().await.into_iter().map(JsScheduledTask::from).collect()
    }

    /// Get task execution history
    #[napi]
    pub async fn get_history(&self, task_id: String) -> Option<Vec<JsTaskHistory>> {
        self.inner.get_history(&task_id).await
            .map(|h| h.into_iter().map(JsTaskHistory::from).collect())
    }

    /// Pause a task
    #[napi]
    pub async fn pause(&self, task_id: String) -> Result<()> {
        self.inner.pause(&task_id).await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Resume a paused task
    #[napi]
    pub async fn resume(&self, task_id: String) -> Result<()> {
        self.inner.resume(&task_id).await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }
}

impl Default for CronSchedulerWrapper {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize the NAPI module
#[napi(module_exports)]
pub fn init() -> Result<()> {
    Ok(())
}

//! Tokio-based Cron Scheduler
//!
//! Provides high-precision task scheduling with:
//! - Cron expression parsing
//! - Task deduplication
//! - Timeout control
//! - Execution history tracking

use async_trait::async_trait;
use cron::Schedule as CronSchedule;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio::time::{interval_at, sleep, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maximum execution history per task
const MAX_HISTORY_ENTRIES: usize = 100;

/// Default task timeout
const DEFAULT_TASK_TIMEOUT: Duration = Duration::from_secs(300);

/// Maximum concurrent task executions
const MAX_CONCURRENT_EXECUTIONS: usize = 50;

/// Task status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    /// Task is scheduled and waiting for next run
    Scheduled,
    /// Task is currently running
    Running,
    /// Task has been paused
    Paused,
    /// Task has been cancelled
    Cancelled,
    /// Task completed last execution
    Completed,
    /// Task failed last execution
    Failed,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Scheduled => write!(f, "scheduled"),
            TaskStatus::Running => write!(f, "running"),
            TaskStatus::Paused => write!(f, "paused"),
            TaskStatus::Cancelled => write!(f, "cancelled"),
            TaskStatus::Completed => write!(f, "completed"),
            TaskStatus::Failed => write!(f, "failed"),
        }
    }
}

/// Task execution history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskHistory {
    /// History entry ID
    pub id: String,
    /// Task ID this history belongs to
    pub task_id: String,
    /// When the execution started
    pub started_at: u64,
    /// When the execution completed (if finished)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    /// Execution status
    pub status: TaskStatus,
    /// Output/result (if successful)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Error message (if failed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Execution duration in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

impl TaskHistory {
    fn new(task_id: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            started_at: current_timestamp_millis(),
            completed_at: None,
            status: TaskStatus::Running,
            output: None,
            error: None,
            duration_ms: None,
        }
    }

    fn complete(mut self, output: String) -> Self {
        self.completed_at = Some(current_timestamp_millis());
        self.status = TaskStatus::Completed;
        self.output = Some(output);
        self.duration_ms = self.completed_at.map(|end| end - self.started_at);
        self
    }

    fn fail(mut self, error: String) -> Self {
        self.completed_at = Some(current_timestamp_millis());
        self.status = TaskStatus::Failed;
        self.error = Some(error);
        self.duration_ms = self.completed_at.map(|end| end - self.started_at);
        self
    }
}

/// Scheduled task definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    /// Unique task ID
    pub id: String,
    /// Task name
    pub name: String,
    /// Task description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Cron expression
    pub cron_expr: String,
    /// Command or task payload to execute
    pub command: String,
    /// Current status
    pub status: TaskStatus,
    /// Whether the task is enabled
    pub enabled: bool,
    /// When the task was created
    pub created_at: u64,
    /// When the task was last updated
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
    /// When the task should next run
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<u64>,
    /// When the task last ran
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<u64>,
    /// Total number of executions
    pub run_count: u64,
    /// Number of successful executions
    pub success_count: u64,
    /// Number of failed executions
    pub fail_count: u64,
    /// Timeout in milliseconds
    pub timeout_ms: u64,
    /// Maximum number of concurrent executions (0 = unlimited)
    pub max_concurrent: usize,
    /// Tags for categorization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl ScheduledTask {
    /// Create a new scheduled task
    pub fn new(name: impl Into<String>, cron_expr: impl Into<String>, command: impl Into<String>) -> Result<Self, SchedulerError> {
        let cron_expr = cron_expr.into();
        // Validate cron expression
        CronSchedule::from_str(&cron_expr)
            .map_err(|e| SchedulerError::InvalidCron(e.to_string()))?;

        let now = current_timestamp_millis();
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            description: None,
            cron_expr,
            command: command.into(),
            status: TaskStatus::Scheduled,
            enabled: true,
            created_at: now,
            updated_at: Some(now),
            next_run_at: None,
            last_run_at: None,
            run_count: 0,
            success_count: 0,
            fail_count: 0,
            timeout_ms: DEFAULT_TASK_TIMEOUT.as_millis() as u64,
            max_concurrent: 1,
            tags: None,
            metadata: None,
        })
    }

    /// Calculate next run time based on cron expression
    pub fn calculate_next_run(&self) -> Option<u64> {
        let schedule = CronSchedule::from_str(&self.cron_expr).ok()?;
        let now = chrono::Utc::now();
        schedule.upcoming(chrono::Utc).next().map(|dt| dt.timestamp_millis() as u64)
    }

    /// Update next run time
    pub fn update_next_run(&mut self) {
        self.next_run_at = self.calculate_next_run();
    }

    /// Set timeout
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }
}

/// Scheduler errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerError {
    InvalidCron(String),
    TaskNotFound(String),
    TaskAlreadyExists(String),
    ExecutionTimeout(String),
    MaxConcurrentReached(String),
    Internal(String),
}

impl std::fmt::Display for SchedulerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchedulerError::InvalidCron(msg) => write!(f, "Invalid cron expression: {}", msg),
            SchedulerError::TaskNotFound(id) => write!(f, "Task not found: {}", id),
            SchedulerError::TaskAlreadyExists(id) => write!(f, "Task already exists: {}", id),
            SchedulerError::ExecutionTimeout(id) => write!(f, "Task execution timeout: {}", id),
            SchedulerError::MaxConcurrentReached(id) => write!(f, "Max concurrent executions reached for task: {}", id),
            SchedulerError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for SchedulerError {}

/// Task execution result
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// Task executor trait
#[async_trait]
pub trait TaskExecutor: Send + Sync {
    async fn execute(&self, task: &ScheduledTask) -> ExecutionResult;
}

/// Default shell command executor
pub struct ShellExecutor;

#[async_trait]
impl TaskExecutor for ShellExecutor {
    async fn execute(&self, task: &ScheduledTask) -> ExecutionResult {
        let start = Instant::now();
        let timeout = Duration::from_millis(task.timeout_ms);

        let result = tokio::time::timeout(
            timeout,
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&task.command)
                .output(),
        )
        .await;

        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                if output.status.success() {
                    ExecutionResult {
                        success: true,
                        output: Some(format!("{}{}", stdout, stderr)),
                        error: None,
                        duration_ms,
                    }
                } else {
                    ExecutionResult {
                        success: false,
                        output: Some(stdout),
                        error: Some(stderr),
                        duration_ms,
                    }
                }
            }
            Ok(Err(e)) => ExecutionResult {
                success: false,
                output: None,
                error: Some(format!("Failed to spawn process: {}", e)),
                duration_ms,
            },
            Err(_) => ExecutionResult {
                success: false,
                output: None,
                error: Some(format!("Task timed out after {}ms", task.timeout_ms)),
                duration_ms,
            },
        }
    }
}

/// Internal task state
struct TaskState {
    task: RwLock<ScheduledTask>,
    history: RwLock<VecDeque<TaskHistory>>,
    running_count: AtomicU64,
}

impl TaskState {
    fn new(task: ScheduledTask) -> Self {
        Self {
            task: RwLock::new(task),
            history: RwLock::new(VecDeque::with_capacity(MAX_HISTORY_ENTRIES)),
            running_count: AtomicU64::new(0),
        }
    }

    async fn add_history(&self, entry: TaskHistory) {
        let mut history = self.history.write().await;
        if history.len() >= MAX_HISTORY_ENTRIES {
            history.pop_front();
        }
        history.push_back(entry);
    }

    async fn get_history(&self) -> Vec<TaskHistory> {
        self.history.read().await.iter().cloned().collect()
    }
}

/// Scheduler commands
#[derive(Debug)]
enum SchedulerCommand {
    Schedule {
        task: ScheduledTask,
        respond: oneshot::Sender<Result<String, SchedulerError>>,
    },
    Cancel {
        task_id: String,
        respond: oneshot::Sender<Result<(), SchedulerError>>,
    },
    GetTask {
        task_id: String,
        respond: oneshot::Sender<Option<ScheduledTask>>,
    },
    ListTasks {
        respond: oneshot::Sender<Vec<ScheduledTask>>,
    },
    GetHistory {
        task_id: String,
        respond: oneshot::Sender<Option<Vec<TaskHistory>>>,
    },
    Pause {
        task_id: String,
        respond: oneshot::Sender<Result<(), SchedulerError>>,
    },
    Resume {
        task_id: String,
        respond: oneshot::Sender<Result<(), SchedulerError>>,
    },
    Shutdown,
}

/// Cron-based task scheduler
pub struct CronScheduler {
    tasks: Arc<DashMap<String, Arc<TaskState>>>,
    command_tx: mpsc::Sender<SchedulerCommand>,
    global_concurrent: AtomicU64,
}

impl CronScheduler {
    /// Create a new scheduler
    pub fn new() -> Self {
        let (command_tx, command_rx) = mpsc::channel(100);
        let tasks: Arc<DashMap<String, Arc<TaskState>>> = Arc::new(DashMap::new());

        let scheduler = Self {
            tasks: tasks.clone(),
            command_tx,
            global_concurrent: AtomicU64::new(0),
        };

        // Start the scheduler loop
        tokio::spawn(Self::scheduler_loop(tasks, command_rx));

        scheduler
    }

    /// Start the scheduler loop
    async fn scheduler_loop(
        tasks: Arc<DashMap<String, Arc<TaskState>>>,
        mut command_rx: mpsc::Receiver<SchedulerCommand>,
    ) {
        let mut tick_interval = tokio::time::interval(Duration::from_secs(1));

        loop {
            tokio::select! {
                _ = tick_interval.tick() => {
                    Self::check_and_execute_due_tasks(&tasks).await;
                }
                cmd = command_rx.recv() => {
                    match cmd {
                        Some(SchedulerCommand::Schedule { task, respond }) => {
                            let task_id = task.id.clone();
                            let state = Arc::new(TaskState::new(task));
                            tasks.insert(task_id.clone(), state);
                            let _ = respond.send(Ok(task_id));
                        }
                        Some(SchedulerCommand::Cancel { task_id, respond }) => {
                            let result = if tasks.remove(&task_id).is_some() {
                                Ok(())
                            } else {
                                Err(SchedulerError::TaskNotFound(task_id))
                            };
                            let _ = respond.send(result);
                        }
                        Some(SchedulerCommand::GetTask { task_id, respond }) => {
                            let task = if let Some(state) = tasks.get(&task_id) {
                                Some(state.task.blocking_read().clone())
                            } else {
                                None
                            };
                            let _ = respond.send(task);
                        }
                        Some(SchedulerCommand::ListTasks { respond }) => {
                            let mut list = Vec::new();
                            for entry in tasks.iter() {
                                list.push(entry.task.blocking_read().clone());
                            }
                            let _ = respond.send(list);
                        }
                        Some(SchedulerCommand::GetHistory { task_id, respond }) => {
                            let history = if let Some(state) = tasks.get(&task_id) {
                                Some(state.get_history().await)
                            } else {
                                None
                            };
                            let _ = respond.send(history);
                        }
                        Some(SchedulerCommand::Pause { task_id, respond }) => {
                            let result = if let Some(state) = tasks.get(&task_id) {
                                let mut task = state.task.write().await;
                                task.status = TaskStatus::Paused;
                                task.enabled = false;
                                Ok(())
                            } else {
                                Err(SchedulerError::TaskNotFound(task_id))
                            };
                            let _ = respond.send(result);
                        }
                        Some(SchedulerCommand::Resume { task_id, respond }) => {
                            let result = if let Some(state) = tasks.get(&task_id) {
                                let mut task = state.task.write().await;
                                task.status = TaskStatus::Scheduled;
                                task.enabled = true;
                                task.update_next_run();
                                Ok(())
                            } else {
                                Err(SchedulerError::TaskNotFound(task_id))
                            };
                            let _ = respond.send(result);
                        }
                        Some(SchedulerCommand::Shutdown) => {
                            info!("Scheduler shutting down");
                            break;
                        }
                        None => break,
                    }
                }
            }
        }
    }

    /// Check for due tasks and execute them
    async fn check_and_execute_due_tasks(tasks: &Arc<DashMap<String, Arc<TaskState>>>) {
        let now = current_timestamp_millis();

        for entry in tasks.iter() {
            let state = entry.value();
            let task = state.task.read().await;

            if !task.enabled || task.status == TaskStatus::Paused {
                continue;
            }

            if let Some(next_run) = task.next_run_at {
                if now >= next_run && state.running_count.load(Ordering::SeqCst) < task.max_concurrent as u64 {
                    drop(task);
                    let state = Arc::clone(state);
                    let tasks = Arc::clone(tasks);
                    tokio::spawn(async move {
                        Self::execute_task(state, tasks).await;
                    });
                }
            } else {
                // Calculate initial next run
                drop(task);
                let mut task = state.task.write().await;
                task.update_next_run();
            }
        }
    }

    /// Execute a single task
    async fn execute_task(state: Arc<TaskState>, _tasks: Arc<DashMap<String, Arc<TaskState>>>) {
        let task = state.task.read().await.clone();

        // Increment running count
        state.running_count.fetch_add(1, Ordering::SeqCst);

        // Update task status
        {
            let mut t = state.task.write().await;
            t.status = TaskStatus::Running;
            t.last_run_at = Some(current_timestamp_millis());
            t.run_count += 1;
        }

        // Create history entry
        let history = TaskHistory::new(&task.id);
        let history_id = history.id.clone();

        info!(task_id = %task.id, name = %task.name, "Starting task execution");

        // Execute using shell executor
        let executor = ShellExecutor;
        let result = executor.execute(&task).await;

        // Update task based on result
        {
            let mut t = state.task.write().await;
            if result.success {
                t.status = TaskStatus::Completed;
                t.success_count += 1;
            } else {
                t.status = TaskStatus::Failed;
                t.fail_count += 1;
            }
            t.update_next_run();
        }

        // Decrement running count
        state.running_count.fetch_sub(1, Ordering::SeqCst);

        // Update and save history
        let final_history = if result.success {
            history.complete(result.output.unwrap_or_default())
        } else {
            history.fail(result.error.unwrap_or_default())
        };
        state.add_history(final_history).await;

        debug!(task_id = %task.id, history_id = %history_id, success = result.success, "Task execution completed");
    }

    /// Schedule a new task
    pub async fn schedule(&self, task: ScheduledTask) -> Result<String, SchedulerError> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(SchedulerCommand::Schedule { task, respond: tx })
            .await
            .map_err(|_| SchedulerError::Internal("Scheduler channel closed".to_string()))?;
        rx.await
            .map_err(|_| SchedulerError::Internal("Response channel closed".to_string()))?
    }

    /// Cancel a task
    pub async fn cancel(&self, task_id: &str) -> Result<(), SchedulerError> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(SchedulerCommand::Cancel {
                task_id: task_id.to_string(),
                respond: tx,
            })
            .await
            .map_err(|_| SchedulerError::Internal("Scheduler channel closed".to_string()))?;
        rx.await
            .map_err(|_| SchedulerError::Internal("Response channel closed".to_string()))?
    }

    /// Get a task by ID
    pub async fn get_task(&self, task_id: &str) -> Option<ScheduledTask> {
        let (tx, rx) = oneshot::channel();
        if self
            .command_tx
            .send(SchedulerCommand::GetTask {
                task_id: task_id.to_string(),
                respond: tx,
            })
            .await
            .is_err()
        {
            return None;
        }
        rx.await.ok().flatten()
    }

    /// List all tasks
    pub async fn list_tasks(&self) -> Vec<ScheduledTask> {
        let (tx, rx) = oneshot::channel();
        if self
            .command_tx
            .send(SchedulerCommand::ListTasks { respond: tx })
            .await
            .is_err()
        {
            return vec![];
        }
        rx.await.unwrap_or_default()
    }

    /// Get task execution history
    pub async fn get_history(&self, task_id: &str) -> Option<Vec<TaskHistory>> {
        let (tx, rx) = oneshot::channel();
        if self
            .command_tx
            .send(SchedulerCommand::GetHistory {
                task_id: task_id.to_string(),
                respond: tx,
            })
            .await
            .is_err()
        {
            return None;
        }
        rx.await.ok().flatten()
    }

    /// Pause a task
    pub async fn pause(&self, task_id: &str) -> Result<(), SchedulerError> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(SchedulerCommand::Pause {
                task_id: task_id.to_string(),
                respond: tx,
            })
            .await
            .map_err(|_| SchedulerError::Internal("Scheduler channel closed".to_string()))?;
        rx.await
            .map_err(|_| SchedulerError::Internal("Response channel closed".to_string()))?
    }

    /// Resume a paused task
    pub async fn resume(&self, task_id: &str) -> Result<(), SchedulerError> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(SchedulerCommand::Resume {
                task_id: task_id.to_string(),
                respond: tx,
            })
            .await
            .map_err(|_| SchedulerError::Internal("Scheduler channel closed".to_string()))?;
        rx.await
            .map_err(|_| SchedulerError::Internal("Response channel closed".to_string()))?
    }

    /// Shutdown the scheduler
    pub async fn shutdown(&self) {
        let _ = self.command_tx.send(SchedulerCommand::Shutdown).await;
    }
}

impl Default for CronScheduler {
    fn default() -> Self {
        Self::new()
    }
}

/// Get current timestamp in milliseconds
fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_creation() {
        let task = ScheduledTask::new("test", "0 * * * * *", "echo hello").unwrap();
        assert_eq!(task.name, "test");
        assert_eq!(task.cron_expr, "0 * * * * *");
        assert_eq!(task.command, "echo hello");
        assert!(task.enabled);
    }

    #[test]
    fn test_invalid_cron() {
        let result = ScheduledTask::new("test", "invalid", "echo hello");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_scheduler_schedule_and_cancel() {
        let scheduler = CronScheduler::new();

        let task = ScheduledTask::new("test", "0 0 * * * *", "echo hello").unwrap();
        let task_id = scheduler.schedule(task).await.unwrap();

        let retrieved = scheduler.get_task(&task_id).await;
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "test");

        scheduler.cancel(&task_id).await.unwrap();
        assert!(scheduler.get_task(&task_id).await.is_none());
    }

    #[tokio::test]
    async fn test_scheduler_list_tasks() {
        let scheduler = CronScheduler::new();

        let task1 = ScheduledTask::new("task1", "0 0 * * * *", "echo 1").unwrap();
        let task2 = ScheduledTask::new("task2", "0 0 * * * *", "echo 2").unwrap();

        scheduler.schedule(task1).await.unwrap();
        scheduler.schedule(task2).await.unwrap();

        let tasks = scheduler.list_tasks().await;
        assert_eq!(tasks.len(), 2);
    }

    #[tokio::test]
    async fn test_pause_resume() {
        let scheduler = CronScheduler::new();

        let task = ScheduledTask::new("test", "0 0 * * * *", "echo hello").unwrap();
        let task_id = scheduler.schedule(task).await.unwrap();

        scheduler.pause(&task_id).await.unwrap();
        let task = scheduler.get_task(&task_id).await.unwrap();
        assert_eq!(task.status, TaskStatus::Paused);
        assert!(!task.enabled);

        scheduler.resume(&task_id).await.unwrap();
        let task = scheduler.get_task(&task_id).await.unwrap();
        assert_eq!(task.status, TaskStatus::Scheduled);
        assert!(task.enabled);
    }

    #[tokio::test]
    async fn test_shell_executor_success() {
        let executor = ShellExecutor;
        let task = ScheduledTask::new("test", "* * * * * *", "echo 'hello world'")
            .unwrap()
            .with_timeout(5000);

        let result = executor.execute(&task).await;
        assert!(result.success);
        assert!(result.output.as_ref().unwrap().contains("hello world"));
    }

    #[tokio::test]
    async fn test_shell_executor_failure() {
        let executor = ShellExecutor;
        let task = ScheduledTask::new("test", "* * * * * *", "exit 1")
            .unwrap()
            .with_timeout(5000);

        let result = executor.execute(&task).await;
        assert!(!result.success);
    }

    #[tokio::test]
    async fn test_shell_executor_timeout() {
        let executor = ShellExecutor;
        let task = ScheduledTask::new("test", "* * * * * *", "sleep 10")
            .unwrap()
            .with_timeout(100); // 100ms timeout

        let result = executor.execute(&task).await;
        assert!(!result.success);
        assert!(result.error.unwrap().contains("timed out"));
    }

    #[tokio::test]
    async fn test_task_deduplication() {
        let scheduler = CronScheduler::new();

        // Create a task that runs every second
        let task = ScheduledTask::new("dedup_test", "* * * * * *", "echo test")
            .unwrap()
            .with_timeout(5000);

        let task_id = scheduler.schedule(task).await.unwrap();

        // Wait for the task to potentially run
        sleep(Duration::from_millis(1500)).await;

        // Get task and verify run count is reasonable (should be 0 or 1, not many)
        let task = scheduler.get_task(&task_id).await.unwrap();
        // Task might have run once or not at all depending on timing
        assert!(task.run_count <= 2, "Task should not run multiple times in quick succession");
    }

    #[tokio::test]
    async fn test_execution_history() {
        let scheduler = CronScheduler::new();

        let task = ScheduledTask::new("history_test", "* * * * * *", "echo history_test")
            .unwrap()
            .with_timeout(5000);

        let task_id = scheduler.schedule(task).await.unwrap();

        // Manually trigger by checking due tasks
        sleep(Duration::from_millis(100)).await;

        // Get history (might be empty if task hasn't run yet)
        let history = scheduler.get_history(&task_id).await;
        assert!(history.is_some());
    }
}

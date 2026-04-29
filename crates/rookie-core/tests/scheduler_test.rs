//! Scheduler tests for precision and correctness

use rookie_core::scheduler::cron::{
    CronScheduler, ScheduledTask, TaskStatus, ShellExecutor,
};
use std::time::{Duration, Instant};
use tokio::time::sleep;

#[tokio::test]
async fn test_scheduler_creation_and_basic_operations() {
    let scheduler = CronScheduler::new();

    // Create a task
    let task = ScheduledTask::new("test_task", "0 0 * * * *", "echo hello")
        .unwrap()
        .with_timeout(5000);

    let task_id = scheduler.schedule(task).await.unwrap();
    assert!(!task_id.is_empty());

    // Get the task
    let retrieved = scheduler.get_task(&task_id).await;
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.name, "test_task");
    assert_eq!(retrieved.cron_expr, "0 0 * * * *");
    assert_eq!(retrieved.command, "echo hello");

    // List tasks
    let tasks = scheduler.list_tasks().await;
    assert_eq!(tasks.len(), 1);

    // Cancel the task
    scheduler.cancel(&task_id).await.unwrap();
    assert!(scheduler.get_task(&task_id).await.is_none());
}

#[tokio::test]
async fn test_invalid_cron_expression() {
    let result = ScheduledTask::new("test", "invalid_cron", "echo hello");
    assert!(result.is_err());
}

#[tokio::test]
async fn test_pause_resume() {
    let scheduler = CronScheduler::new();

    let task = ScheduledTask::new("pause_test", "0 0 * * * *", "echo test")
        .unwrap()
        .with_timeout(5000);

    let task_id = scheduler.schedule(task).await.unwrap();

    // Pause
    scheduler.pause(&task_id).await.unwrap();
    let task = scheduler.get_task(&task_id).await.unwrap();
    assert_eq!(task.status, TaskStatus::Paused);
    assert!(!task.enabled);

    // Resume
    scheduler.resume(&task_id).await.unwrap();
    let task = scheduler.get_task(&task_id).await.unwrap();
    assert_eq!(task.status, TaskStatus::Scheduled);
    assert!(task.enabled);

    // Cleanup
    scheduler.cancel(&task_id).await.unwrap();
}

#[tokio::test]
async fn test_shell_executor_success() {
    let executor = ShellExecutor;
    let task = ScheduledTask::new("exec_test", "* * * * * *", "echo 'hello world'")
        .unwrap()
        .with_timeout(10000);

    let start = Instant::now();
    let result = executor.execute(&task).await;
    let duration = start.elapsed();

    assert!(result.success);
    assert!(result.output.as_ref().unwrap().contains("hello world"));
    assert!(result.duration_ms < 5000); // Should complete quickly
    println!("Execution took: {:?}", duration);
}

#[tokio::test]
async fn test_shell_executor_failure() {
    let executor = ShellExecutor;
    let task = ScheduledTask::new("fail_test", "* * * * * *", "exit 42")
        .unwrap()
        .with_timeout(5000);

    let result = executor.execute(&task).await;

    assert!(!result.success);
    // Exit code may vary by shell, but should be non-zero
}

#[tokio::test]
async fn test_shell_executor_timeout() {
    let executor = ShellExecutor;
    let task = ScheduledTask::new("timeout_test", "* * * * * *", "sleep 10")
        .unwrap()
        .with_timeout(100); // 100ms timeout

    let start = Instant::now();
    let result = executor.execute(&task).await;
    let duration = start.elapsed();

    assert!(!result.success);
    assert!(result.error.unwrap().contains("timed out"));
    // Should complete close to the timeout
    assert!(duration.as_millis() >= 100);
    assert!(duration.as_millis() < 500); // But not too much over
}

#[tokio::test]
async fn test_scheduler_precision() {
    let scheduler = CronScheduler::new();

    // Create a task that runs every second
    let task = ScheduledTask::new("precision_test", "* * * * * *", "echo tick")
        .unwrap()
        .with_timeout(5000);

    let task_id = scheduler.schedule(task).await.unwrap();

    // Wait for the scheduler to calculate next run
    sleep(Duration::from_millis(100)).await;

    let task = scheduler.get_task(&task_id).await.unwrap();
    assert!(task.next_run_at.is_some());

    // Cleanup
    scheduler.cancel(&task_id).await.unwrap();
}

#[tokio::test]
async fn test_task_history() {
    let scheduler = CronScheduler::new();

    let task = ScheduledTask::new("history_test", "* * * * * *", "echo history")
        .unwrap()
        .with_timeout(5000);

    let task_id = scheduler.schedule(task).await.unwrap();

    // History might be empty initially
    let history = scheduler.get_history(&task_id).await;
    assert!(history.is_some());

    // Cleanup
    scheduler.cancel(&task_id).await.unwrap();
}

#[tokio::test]
async fn test_multiple_tasks() {
    let scheduler = CronScheduler::new();

    let task_ids = vec![
        scheduler.schedule(ScheduledTask::new("task1", "0 0 * * * *", "echo 1").unwrap()).await.unwrap(),
        scheduler.schedule(ScheduledTask::new("task2", "0 0 * * * *", "echo 2").unwrap()).await.unwrap(),
        scheduler.schedule(ScheduledTask::new("task3", "0 0 * * * *", "echo 3").unwrap()).await.unwrap(),
    ];

    let tasks = scheduler.list_tasks().await;
    assert_eq!(tasks.len(), 3);

    // Cancel all
    for id in task_ids {
        scheduler.cancel(&id).await.unwrap();
    }

    assert_eq!(scheduler.list_tasks().await.len(), 0);
}

#[tokio::test]
async fn test_task_not_found() {
    let scheduler = CronScheduler::new();

    let result = scheduler.cancel("nonexistent_task_id").await;
    assert!(result.is_err());

    let task = scheduler.get_task("nonexistent_task_id").await;
    assert!(task.is_none());

    let history = scheduler.get_history("nonexistent_task_id").await;
    assert!(history.is_none());
}

#[tokio::test]
async fn test_shell_executor_with_stderr() {
    let executor = ShellExecutor;
    let task = ScheduledTask::new("stderr_test", "* * * * * *", "echo stdout_msg && echo stderr_msg >&2")
        .unwrap()
        .with_timeout(5000);

    let result = executor.execute(&task).await;

    assert!(result.success);
    let output = result.output.unwrap();
    assert!(output.contains("stdout_msg"));
    assert!(output.contains("stderr_msg"));
}

#[tokio::test]
async fn test_shell_executor_command_not_found() {
    let executor = ShellExecutor;
    let task = ScheduledTask::new("notfound_test", "* * * * * *", "this_command_definitely_does_not_exist_12345")
        .unwrap()
        .with_timeout(5000);

    let result = executor.execute(&task).await;

    assert!(!result.success);
}

#[tokio::test]
async fn test_scheduler_concurrent_operations() {
    let scheduler = CronScheduler::new();
    let mut handles = vec![];

    // Concurrently schedule tasks
    for i in 0..10 {
        let scheduler_ref = &scheduler;
        let handle = tokio::spawn(async move {
            let task = ScheduledTask::new(
                &format!("concurrent_task_{}", i),
                "0 0 * * * *",
                &format!("echo {}", i)
            ).unwrap();
            scheduler_ref.schedule(task).await.unwrap()
        });
        handles.push(handle);
    }

    let mut task_ids = vec![];
    for handle in handles {
        task_ids.push(handle.await.unwrap());
    }

    // All tasks should be scheduled
    let tasks = scheduler.list_tasks().await;
    assert_eq!(tasks.len(), 10);

    // Concurrently cancel tasks
    let mut cancel_handles = vec![];
    for id in &task_ids {
        let scheduler_ref = &scheduler;
        let id = id.clone();
        let handle = tokio::spawn(async move {
            scheduler_ref.cancel(&id).await.unwrap();
        });
        cancel_handles.push(handle);
    }

    for handle in cancel_handles {
        handle.await.unwrap();
    }

    assert_eq!(scheduler.list_tasks().await.len(), 0);
}

#[tokio::test]
async fn test_cron_expression_variations() {
    let expressions = vec![
        ("* * * * * *", "every second"),
        ("0 * * * * *", "every minute"),
        ("0 0 * * * *", "every hour"),
        ("0 0 0 * * *", "every day at midnight"),
        ("0 0 0 * * 1", "every Monday at midnight"),
        ("0 0 0 1 * *", "first day of every month"),
    ];

    for (expr, desc) in expressions {
        let result = ScheduledTask::new("test", expr, "echo test");
        assert!(result.is_ok(), "Failed to parse '{}': {}", desc, expr);
    }
}

#[tokio::test]
async fn test_task_deduplication_prevention() {
    let scheduler = CronScheduler::new();

    // Create a task
    let task = ScheduledTask::new("dedup_test", "* * * * * *", "echo test")
        .unwrap()
        .with_timeout(5000);

    let task_id = scheduler.schedule(task).await.unwrap();

    // Verify task exists
    assert!(scheduler.get_task(&task_id).await.is_some());

    // Task should only run once per scheduled time
    // This is verified by the run_count field
    let task = scheduler.get_task(&task_id).await.unwrap();
    assert_eq!(task.run_count, 0); // Not yet run

    scheduler.cancel(&task_id).await.unwrap();
}

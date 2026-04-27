//! Smoke tests for the `rookie_core::logger` module.
//!
//! NOTE: all assertions are inside a single `#[tokio::test]` because the logger
//! installs a **global** tracing subscriber. Running multiple tests in parallel
//! against a global singleton causes non-deterministic races where one thread's
//! `init()` wins the subscriber install before the other thread subscribes;
//! the loser then calls `tracing::info!` but the broadcast channel may lose
//! the first packet if the subscriber layer is still racing into place. A
//! single serial test side-steps the issue entirely while still exercising
//! all code paths.

use rookie_core::logger::{self, LogEvent};

#[tokio::test]
async fn logger_emits_and_forwards_structured_events() {
    let mut rx = logger::init();

    // ── 1) Explicit emit() reaches the broadcast receiver ────────────────
    logger::emit(LogEvent {
        ts: "2026-04-23T00:00:00.000Z".into(),
        level: "info".into(),
        msg: "hello-emit".into(),
        session_id: Some("s-1".into()),
        agent: None,
        tool: None,
        duration_ms: None,
        extra: serde_json::Map::new(),
    });

    wait_for(&mut rx, "hello-emit", |ev| {
        assert_eq!(ev.session_id.as_deref(), Some("s-1"));
    })
    .await;

    // ── 2) tracing::info! carries structured fields end-to-end ───────────
    tracing::info!(tool = "file_read", duration_ms = 3u64, "tool.invoke");

    wait_for(&mut rx, "tool.invoke", |ev| {
        assert_eq!(ev.tool.as_deref(), Some("file_read"));
        assert_eq!(ev.duration_ms, Some(3));
    })
    .await;
}

/// Drain `rx` until a `LogEvent` whose `msg` equals `want` arrives, then run
/// assertions on it. Panics after ~1s total deadline.
async fn wait_for(
    rx: &mut tokio::sync::broadcast::Receiver<LogEvent>,
    want: &str,
    check: impl FnOnce(&LogEvent),
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1_000);
    loop {
        if std::time::Instant::now() > deadline {
            panic!("timed out waiting for `{}` log event", want);
        }
        let recv = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await;
        match recv {
            Ok(Ok(ev)) if ev.msg == want => {
                check(&ev);
                return;
            }
            _ => continue,
        }
    }
}

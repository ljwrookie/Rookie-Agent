//! Structured logging for rookie-core.
//!
//! Bridges the `tracing` ecosystem with the JSON-RPC transport so that every
//! log record emitted from the compute engine can be forwarded to the TS
//! orchestration layer as a `log.event` notification.
//!
//! The fan-out uses `tokio::sync::broadcast` so both the stdio forwarder and
//! tests (or future in-process clients) can subscribe simultaneously.

use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::broadcast::{Receiver, Sender, channel};
use tracing_subscriber::prelude::*;

/// Canonical fields emitted on every log record. Mirrors the TS `LogRecord`
/// shape so callers can deserialise symmetrically.
#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub ts: String,
    pub level: String,
    pub msg: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u128>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Global broadcast sender. Initialised once; subsequent `init()` calls hand
/// out fresh receivers attached to the same channel.
static EVENT_TX: OnceLock<Sender<LogEvent>> = OnceLock::new();
/// Capacity large enough to avoid back-pressure for short CLI sessions.
const CHANNEL_CAPACITY: usize = 1024;

/// Install the global tracing subscriber (idempotent) and return a fresh
/// broadcast receiver.
///
/// The first call sets up the `ChannelLayer` and env-filter based subscriber;
/// subsequent calls simply `.subscribe()` to the existing broadcast channel.
pub fn init() -> Receiver<LogEvent> {
    if let Some(tx) = EVENT_TX.get() {
        return tx.subscribe();
    }

    let (tx, rx) = channel::<LogEvent>(CHANNEL_CAPACITY);
    if EVENT_TX.set(tx).is_err() {
        // Race: someone beat us to it. Just subscribe to whatever's live.
        return EVENT_TX.get().expect("EVENT_TX set").subscribe();
    }

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(ChannelLayer)
        .try_init();

    rx
}

/// Emit a structured log event directly (bypassing the tracing macros). Useful
/// for code paths that already have structured fields on hand.
pub fn emit(event: LogEvent) {
    if let Some(tx) = EVENT_TX.get() {
        let _ = tx.send(event);
    }
}

struct ChannelLayer;

impl<S> tracing_subscriber::Layer<S> for ChannelLayer
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let tx = match EVENT_TX.get() {
            Some(tx) => tx,
            None => return,
        };

        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let metadata = event.metadata();
        let ts = now_iso();
        let msg = visitor.msg.unwrap_or_else(|| metadata.name().to_string());

        let ev = LogEvent {
            ts,
            level: metadata.level().to_string().to_lowercase(),
            msg,
            session_id: visitor.session_id,
            agent: visitor.agent,
            tool: visitor.tool,
            duration_ms: visitor.duration_ms,
            extra: visitor.extra,
        };

        let _ = tx.send(ev);
    }
}

#[derive(Default)]
struct FieldVisitor {
    msg: Option<String>,
    session_id: Option<String>,
    agent: Option<String>,
    tool: Option<String>,
    duration_ms: Option<u128>,
    extra: serde_json::Map<String, serde_json::Value>,
}

impl tracing::field::Visit for FieldVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        match field.name() {
            "message" | "msg" => self.msg = Some(value.to_string()),
            "session_id" => self.session_id = Some(value.to_string()),
            "agent" => self.agent = Some(value.to_string()),
            "tool" => self.tool = Some(value.to_string()),
            other => {
                self.extra
                    .insert(other.to_string(), serde_json::Value::String(value.to_string()));
            }
        }
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        if field.name() == "duration_ms" {
            self.duration_ms = Some(value as u128);
        } else {
            self.extra.insert(field.name().to_string(), value.into());
        }
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        if field.name() == "duration_ms" {
            self.duration_ms = Some(value as u128);
        } else {
            self.extra.insert(field.name().to_string(), value.into());
        }
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.extra.insert(field.name().to_string(), value.into());
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let s = format!("{:?}", value);
        if field.name() == "message" {
            let trimmed = s.trim_matches('"').to_string();
            self.msg = Some(trimmed);
        } else {
            self.extra
                .insert(field.name().to_string(), serde_json::Value::String(s));
        }
    }
}

/// Minimal RFC-3339 timestamp without pulling in `chrono`.
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let (year, month, day, hh, mm, ss) = split_epoch_seconds(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hh, mm, ss, millis
    )
}

fn split_epoch_seconds(mut secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let ss = (secs % 60) as u32;
    secs /= 60;
    let mm = (secs % 60) as u32;
    secs /= 60;
    let hh = (secs % 24) as u32;
    let mut days = secs / 24;

    let mut year: u32 = 1970;
    loop {
        let ydays = if is_leap(year) { 366 } else { 365 };
        if days >= ydays {
            days -= ydays;
            year += 1;
        } else {
            break;
        }
    }

    let mdays: [u32; 12] = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 0usize;
    let mut days_rem = days as u32;
    while month < 12 && days_rem >= mdays[month] {
        days_rem -= mdays[month];
        month += 1;
    }
    (year, (month + 1) as u32, days_rem + 1, hh, mm, ss)
}

fn is_leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

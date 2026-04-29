//! NAPI-RS bindings for Rookie Core
//!
//! Exposes high-performance Rust engines to Node.js/TypeScript

use napi::bindgen_prelude::*;
use napi_derive::napi;

// Re-export modules
mod bindings;
mod diff;
mod search;

pub use bindings::*;
pub use diff::*;
pub use search::*;

/// Initialize the Rust core
#[napi]
pub fn rookie_core_init() -> Result<()> {
    // Initialize tracing if not already done
    let _ = tracing_subscriber::fmt()
        .with_env_filter("info")
        .try_init();
    Ok(())
}

/// Get version info
#[napi]
pub fn rookie_core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

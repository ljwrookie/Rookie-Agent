//! Search engines for Rookie Core
//!
//! Provides high-performance file search capabilities:
//! - `grep`: Regex-based content search using grep-searcher
//! - `glob`: Pattern-based file matching using globset

pub mod glob;
pub mod grep;

pub use glob::{glob_match, GlobMatchResult};
pub use grep::{grep_search, GrepOptions, GrepResult, Match};

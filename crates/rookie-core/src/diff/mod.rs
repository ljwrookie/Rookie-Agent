//! Diff/Patch engine for Rookie Core
//!
//! Provides high-performance diff computation and patch application:
//! - `engine`: TextDiff with multiple algorithms (patience, histogram)
//! - `patch`: Patch application with fuzzy matching and 3-way merge

pub mod engine;
pub mod patch;

pub use engine::{compute_diff, did_you_mean, Algorithm, DiffOptions, DiffResult, LineDiff};
pub use patch::{apply_patch, apply_patch_fuzzy, PatchOptions, PatchResult};

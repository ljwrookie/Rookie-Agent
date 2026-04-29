//! NAPI-RS bindings for diff/patch engines

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use crate::diff::{engine as diff_engine, patch as patch_engine};

// =============================================================================
// Diff Engine Bindings
// =============================================================================

/// Diff algorithm selection
#[napi]
pub enum DiffAlgorithm {
    Myers,
    Patience,
    Histogram,
}

impl From<DiffAlgorithm> for diff_engine::Algorithm {
    fn from(alg: DiffAlgorithm) -> Self {
        match alg {
            DiffAlgorithm::Myers => diff_engine::Algorithm::Myers,
            DiffAlgorithm::Patience => diff_engine::Algorithm::Patience,
            DiffAlgorithm::Histogram => diff_engine::Algorithm::Histogram,
        }
    }
}

/// A single line-level diff
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineDiff {
    pub tag: DiffTag,
    pub old_index: Option<u32>,
    pub new_index: Option<u32>,
    pub content: String,
}

/// Diff tag
#[napi]
pub enum DiffTag {
    Equal,
    Delete,
    Insert,
    Replace,
}

impl From<diff_engine::DiffTag> for DiffTag {
    fn from(tag: diff_engine::DiffTag) -> Self {
        match tag {
            diff_engine::DiffTag::Equal => DiffTag::Equal,
            diff_engine::DiffTag::Delete => DiffTag::Delete,
            diff_engine::DiffTag::Insert => DiffTag::Insert,
            diff_engine::DiffTag::Replace => DiffTag::Replace,
        }
    }
}

/// Diff computation result
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub lines: Vec<LineDiff>,
    pub additions: u32,
    pub deletions: u32,
    pub unchanged: u32,
    pub unified_diff: String,
    pub duration_ms: u64,
}

/// Options for diff computation
#[napi(object)]
#[derive(Debug, Clone)]
pub struct DiffOptions {
    pub algorithm: Option<DiffAlgorithm>,
    pub context_lines: Option<u32>,
    pub ignore_whitespace: Option<bool>,
    pub ignore_case: Option<bool>,
}

/// Compute diff between old and new text
#[napi]
pub fn compute_diff(old_text: String, new_text: String, options: Option<DiffOptions>) -> Result<DiffResult> {
    let opts = options.map(|o| diff_engine::DiffOptions {
        algorithm: o.algorithm.map(|a| a.into()).unwrap_or_default(),
        context_lines: o.context_lines.map(|c| c as usize).unwrap_or(3),
        ignore_whitespace: o.ignore_whitespace.unwrap_or(false),
        ignore_case: o.ignore_case.unwrap_or(false),
        newline_style: "\n".to_string(),
    }).unwrap_or_default();

    let result = diff_engine::compute_diff(&old_text, &new_text, opts);

    Ok(DiffResult {
        lines: result.lines.into_iter().map(|l| LineDiff {
            tag: l.tag.into(),
            old_index: l.old_index.map(|i| i as u32),
            new_index: l.new_index.map(|i| i as u32),
            content: l.content,
        }).collect(),
        additions: result.additions as u32,
        deletions: result.deletions as u32,
        unchanged: result.unchanged as u32,
        unified_diff: result.unified_diff,
        duration_ms: result.duration_ms,
    })
}

/// Fuzzy matching: suggest similar strings
#[napi]
pub fn did_you_mean(input: String, candidates: Vec<String>) -> Option<String> {
    diff_engine::did_you_mean(&input, &candidates).map(|(s, _)| s)
}

// =============================================================================
// Patch Engine Bindings
// =============================================================================

/// Patch operation type
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchOp {
    pub kind: String, // "context", "delete", "add"
    pub line: String,
}

/// Patch application result
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchResult {
    pub success: bool,
    pub content: String,
    pub applied_hunks: u32,
    pub failed_hunks: Vec<FailedHunk>,
    pub fuzz: u32,
}

/// Failed hunk information
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedHunk {
    pub hunk_index: u32,
    pub old_start: u32,
    pub reason: String,
}

/// Options for patch application
#[napi(object)]
#[derive(Debug, Clone)]
pub struct PatchOptions {
    pub fuzzy: Option<bool>,
    pub max_offset: Option<u32>,
    pub max_fuzz: Option<u32>,
    pub ignore_whitespace: Option<bool>,
}

/// Apply a unified diff patch to source content
#[napi]
pub fn apply_patch(source: String, diff: String, options: Option<PatchOptions>) -> Result<PatchResult> {
    let patch = patch_engine::parse_unified_diff(&diff)
        .map_err(|e| Error::from_reason(format!("Failed to parse diff: {}", e)))?;

    let opts = options.map(|o| patch_engine::PatchOptions {
        fuzzy: o.fuzzy.unwrap_or(true),
        max_offset: o.max_offset.map(|o| o as usize).unwrap_or(10),
        max_fuzz: o.max_fuzz.map(|f| f as usize).unwrap_or(2),
        reverse: false,
        ignore_whitespace: o.ignore_whitespace.unwrap_or(false),
    }).unwrap_or_default();

    let result = patch_engine::apply_patch(&source, &patch, &opts);

    Ok(PatchResult {
        success: result.success,
        content: result.content,
        applied_hunks: result.applied_hunks as u32,
        failed_hunks: result.failed_hunks.into_iter().map(|h| FailedHunk {
            hunk_index: h.hunk_index as u32,
            old_start: h.old_start as u32,
            reason: h.reason,
        }).collect(),
        fuzz: result.fuzz as u32,
    })
}

/// Apply patch with fuzzy matching enabled
#[napi]
pub fn apply_patch_fuzzy(source: String, diff: String) -> Result<PatchResult> {
    let result = patch_engine::apply_patch_fuzzy(&source, &diff)
        .map_err(|e| Error::from_reason(format!("Failed to apply patch: {}", e)))?;

    Ok(PatchResult {
        success: result.success,
        content: result.content,
        applied_hunks: result.applied_hunks as u32,
        failed_hunks: result.failed_hunks.into_iter().map(|h| FailedHunk {
            hunk_index: h.hunk_index as u32,
            old_start: h.old_start as u32,
            reason: h.reason,
        }).collect(),
        fuzz: result.fuzz as u32,
    })
}

/// 3-way merge: combine base, ours, and theirs
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub content: String,
    pub has_conflicts: bool,
    pub conflicts: Vec<MergeConflict>,
}

/// Merge conflict information
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflict {
    pub base_line: u32,
    pub base_content: String,
    pub ours_content: String,
    pub theirs_content: String,
}

/// Perform 3-way merge
#[napi]
pub fn three_way_merge(base: String, ours: String, theirs: String) -> MergeResult {
    let (content, conflicts) = patch_engine::three_way_merge(&base, &ours, &theirs);

    MergeResult {
        has_conflicts: !conflicts.is_empty(),
        content,
        conflicts: conflicts.into_iter().map(|c| MergeConflict {
            base_line: c.base_line as u32,
            base_content: c.base_content,
            ours_content: c.ours_content,
            theirs_content: c.theirs_content,
        }).collect(),
    }
}

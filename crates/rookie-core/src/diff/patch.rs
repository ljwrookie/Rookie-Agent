//! Patch application engine with fuzzy matching and 3-way merge
//!
//! Features:
//! - Apply unified diff patches
//! - Fuzzy patch: tolerate line offsets
//! - 3-way merge for conflict resolution
//! - Performance optimized

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Patch operation type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PatchOp {
    /// Context line (must match)
    Context { line: String },
    /// Delete line
    Delete { line: String },
    /// Add line
    Add { line: String },
}

/// A single hunk in a patch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub ops: Vec<PatchOp>,
}

/// Parsed patch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Patch {
    pub old_file: Option<String>,
    pub new_file: Option<String>,
    pub hunks: Vec<Hunk>,
}

/// Patch application result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchResult {
    pub success: bool,
    pub content: String,
    pub applied_hunks: usize,
    pub failed_hunks: Vec<FailedHunk>,
    pub fuzz: usize,
}

/// Failed hunk information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedHunk {
    pub hunk_index: usize,
    pub old_start: usize,
    pub reason: String,
}

/// Options for patch application
#[derive(Debug, Clone)]
pub struct PatchOptions {
    /// Allow fuzzy matching with offset tolerance
    pub fuzzy: bool,
    /// Maximum offset for fuzzy matching
    pub max_offset: usize,
    /// Maximum fuzz factor (lines that can differ)
    pub max_fuzz: usize,
    /// Reverse the patch (apply in reverse)
    pub reverse: bool,
    /// Ignore whitespace differences
    pub ignore_whitespace: bool,
}

impl Default for PatchOptions {
    fn default() -> Self {
        Self {
            fuzzy: true,
            max_offset: 10,
            max_fuzz: 2,
            reverse: false,
            ignore_whitespace: false,
        }
    }
}

/// Parse a unified diff into a Patch structure
pub fn parse_unified_diff(diff: &str) -> anyhow::Result<Patch> {
    let mut patch = Patch {
        old_file: None,
        new_file: None,
        hunks: Vec::new(),
    };

    let mut current_hunk: Option<Hunk> = None;
    let lines: Vec<&str> = diff.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Parse file headers
        if line.starts_with("--- ") {
            patch.old_file = Some(parse_file_header(line));
            i += 1;
            continue;
        }

        if line.starts_with("+++ ") {
            patch.new_file = Some(parse_file_header(line));
            i += 1;
            continue;
        }

        // Parse hunk header
        if line.starts_with("@@") {
            // Save previous hunk
            if let Some(hunk) = current_hunk.take() {
                patch.hunks.push(hunk);
            }

            // Parse hunk header: @@ -old_start,old_lines +new_start,new_lines @@
            let header_re = regex::Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@").unwrap();
            if let Some(caps) = header_re.captures(line) {
                let old_start = caps[1].parse::<usize>()?;
                let old_lines = caps.get(2).map(|m| m.as_str().parse().unwrap_or(1)).unwrap_or(1);
                let new_start = caps[3].parse::<usize>()?;
                let new_lines = caps.get(4).map(|m| m.as_str().parse().unwrap_or(1)).unwrap_or(1);

                current_hunk = Some(Hunk {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    ops: Vec::new(),
                });
            }
            i += 1;
            continue;
        }

        // Parse hunk operations
        if let Some(ref mut hunk) = current_hunk {
            if let Some(op) = parse_patch_op(line) {
                hunk.ops.push(op);
            }
        }

        i += 1;
    }

    // Save last hunk
    if let Some(hunk) = current_hunk {
        patch.hunks.push(hunk);
    }

    Ok(patch)
}

fn parse_file_header(line: &str) -> String {
    // Remove "--- " or "+++ " prefix and timestamp
    let content = &line[4..];
    if let Some(tab_pos) = content.find('\t') {
        content[..tab_pos].to_string()
    } else {
        content.to_string()
    }
}

fn parse_patch_op(line: &str) -> Option<PatchOp> {
    if line.is_empty() {
        return Some(PatchOp::Context { line: "".to_string() });
    }

    match line.chars().next() {
        Some(' ') => Some(PatchOp::Context {
            line: line[1..].to_string(),
        }),
        Some('-') => Some(PatchOp::Delete {
            line: line[1..].to_string(),
        }),
        Some('+') => Some(PatchOp::Add {
            line: line[1..].to_string(),
        }),
        Some('\\') => None, // Ignore "\ No newline at end of file"
        _ => None,
    }
}

/// Apply a patch to source content
pub fn apply_patch(source: &str, patch: &Patch, options: &PatchOptions) -> PatchResult {
    let mut lines: Vec<String> = source.lines().map(|s| s.to_string()).collect();
    let mut applied_hunks = 0;
    let mut failed_hunks = Vec::new();
    let mut total_fuzz = 0;

    // Track which lines have been modified
    let mut line_offsets: HashMap<usize, isize> = HashMap::new();

    for (hunk_idx, hunk) in patch.hunks.iter().enumerate() {
        // Calculate actual position considering previous modifications
        let offset = line_offsets
            .iter()
            .filter(|(k, _)| **k < hunk.old_start)
            .map(|(_, v)| *v)
            .sum::<isize>();

        let adjusted_start = (hunk.old_start as isize + offset) as usize;

        // Try to apply hunk
        match apply_hunk(&lines, hunk, adjusted_start, options) {
            Ok((new_lines, fuzz)) => {
                lines = new_lines;
                applied_hunks += 1;
                total_fuzz += fuzz;

                // Update offsets for subsequent hunks
                let line_delta = hunk.new_lines as isize - hunk.old_lines as isize;
                line_offsets.insert(hunk.old_start, line_delta);
            }
            Err(reason) => {
                // Try fuzzy matching if enabled
                if options.fuzzy {
                    match try_fuzzy_apply(&lines, hunk, adjusted_start, options) {
                        Ok((new_lines, fuzz)) => {
                            lines = new_lines;
                            applied_hunks += 1;
                            total_fuzz += fuzz;
                            continue;
                        }
                        Err(_) => {}
                    }
                }

                failed_hunks.push(FailedHunk {
                    hunk_index: hunk_idx,
                    old_start: hunk.old_start,
                    reason,
                });
            }
        }
    }

    let success = failed_hunks.is_empty();
    let content = lines.join("\n");

    PatchResult {
        success,
        content,
        applied_hunks,
        failed_hunks,
        fuzz: total_fuzz,
    }
}

/// Apply a single hunk at the specified position
fn apply_hunk(
    lines: &[String],
    hunk: &Hunk,
    start: usize,
    options: &PatchOptions,
) -> Result<(Vec<String>, usize), String> {
    let start_idx = start.saturating_sub(1); // Convert to 0-indexed

    // Verify we have enough lines
    let expected_lines = hunk
        .ops
        .iter()
        .filter(|op| matches!(op, PatchOp::Context { .. } | PatchOp::Delete { .. }))
        .count();

    if start_idx + expected_lines > lines.len() {
        return Err("Not enough lines at position".to_string());
    }

    // Verify context and delete lines match
    let mut source_idx = start_idx;
    let mut fuzz = 0;

    for op in &hunk.ops {
        match op {
            PatchOp::Context { line } | PatchOp::Delete { line } => {
                if source_idx >= lines.len() {
                    return Err("Unexpected end of file".to_string());
                }

                let source_line = &lines[source_idx];
                if !lines_match(source_line, line, options.ignore_whitespace) {
                    // Allow some fuzz in context lines
                    if fuzz < options.max_fuzz && matches!(op, PatchOp::Context { .. }) {
                        fuzz += 1;
                    } else {
                        return Err(format!(
                            "Context mismatch at line {}: expected {:?}, got {:?}",
                            source_idx + 1,
                            line,
                            source_line
                        ));
                    }
                }

                if matches!(op, PatchOp::Context { .. }) {
                    source_idx += 1;
                } else {
                    source_idx += 1;
                }
            }
            PatchOp::Add { .. } => {
                // Add lines don't consume source
            }
        }
    }

    // Apply the hunk
    let mut new_lines = lines[..start_idx].to_vec();
    source_idx = start_idx;

    for op in &hunk.ops {
        match op {
            PatchOp::Context { .. } => {
                new_lines.push(lines[source_idx].clone());
                source_idx += 1;
            }
            PatchOp::Delete { .. } => {
                source_idx += 1; // Skip deleted line
            }
            PatchOp::Add { line } => {
                new_lines.push(line.clone());
            }
        }
    }

    // Append remaining lines
    new_lines.extend_from_slice(&lines[source_idx..]);

    Ok((new_lines, fuzz))
}

/// Try fuzzy application with offset search
fn try_fuzzy_apply(
    lines: &[String],
    hunk: &Hunk,
    start: usize,
    options: &PatchOptions,
) -> Result<(Vec<String>, usize), String> {
    // Search around the expected position
    let search_start = start.saturating_sub(options.max_offset);
    let search_end = (start + options.max_offset).min(lines.len());

    for offset in search_start..=search_end {
        if let Ok(result) = apply_hunk(lines, hunk, offset, options) {
            return Ok(result);
        }
    }

    Err("Could not find matching context with fuzzy search".to_string())
}

/// Check if two lines match (with optional whitespace ignoring)
fn lines_match(a: &str, b: &str, ignore_whitespace: bool) -> bool {
    if ignore_whitespace {
        a.trim() == b.trim()
    } else {
        a == b
    }
}

/// Apply patch with fuzzy matching enabled by default
pub fn apply_patch_fuzzy(source: &str, diff: &str) -> anyhow::Result<PatchResult> {
    let patch = parse_unified_diff(diff)?;
    let options = PatchOptions {
        fuzzy: true,
        max_offset: 10,
        max_fuzz: 2,
        ..Default::default()
    };

    Ok(apply_patch(source, &patch, &options))
}

/// 3-way merge: combine base, ours, and theirs
///
/// Returns merged content and any conflicts
pub fn three_way_merge(
    base: &str,
    ours: &str,
    theirs: &str,
) -> (String, Vec<MergeConflict>) {
    let base_lines: Vec<&str> = base.lines().collect();
    let ours_lines: Vec<&str> = ours.lines().collect();
    let theirs_lines: Vec<&str> = theirs.lines().collect();

    let mut result = Vec::new();
    let mut conflicts = Vec::new();

    // Simple 3-way merge: check if changes overlap
    let base_to_ours = compute_line_diff(&base_lines, &ours_lines);
    let base_to_theirs = compute_line_diff(&base_lines, &theirs_lines);

    let mut i = 0;
    while i < base_lines.len() {
        let our_change = base_to_ours.get(&i);
        let their_change = base_to_theirs.get(&i);

        match (our_change, their_change) {
            (None, None) => {
                // No changes
                result.push(base_lines[i].to_string());
                i += 1;
            }
            (Some(our), None) => {
                // Only we changed this
                result.extend(our.iter().map(|s| s.to_string()));
                i += 1;
            }
            (None, Some(their)) => {
                // Only they changed this
                result.extend(their.iter().map(|s| s.to_string()));
                i += 1;
            }
            (Some(our), Some(their)) => {
                // Both changed - check if same
                if our == their {
                    result.extend(our.iter().map(|s| s.to_string()));
                } else {
                    // Conflict!
                    conflicts.push(MergeConflict {
                        base_line: i + 1,
                        base_content: base_lines[i].to_string(),
                        ours_content: our.join("\n"),
                        theirs_content: their.join("\n"),
                    });

                    // Add conflict markers
                    result.push("<<<<<<< ours".to_string());
                    result.extend(our.iter().map(|s| s.to_string()));
                    result.push("=======".to_string());
                    result.extend(their.iter().map(|s| s.to_string()));
                    result.push(">>>>>>> theirs".to_string());
                }
                i += 1;
            }
        }
    }

    (result.join("\n"), conflicts)
}

/// Merge conflict information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflict {
    pub base_line: usize,
    pub base_content: String,
    pub ours_content: String,
    pub theirs_content: String,
}

/// Compute simple line-level diff (for 3-way merge)
fn compute_line_diff<'a>(
    base: &[&'a str],
    modified: &[&'a str],
) -> HashMap<usize, Vec<&'a str>> {
    let mut changes = HashMap::new();

    // Simple approach: find lines that differ
    let mut base_idx = 0;
    let mut mod_idx = 0;

    while base_idx < base.len() && mod_idx < modified.len() {
        if base[base_idx] != modified[mod_idx] {
            // Find how many lines changed
            let start_base = base_idx;
            let start_mod = mod_idx;

            while mod_idx < modified.len() && (base_idx >= base.len() || base[base_idx] != modified[mod_idx]) {
                mod_idx += 1;
            }

            let changed_lines: Vec<&str> = modified[start_mod..mod_idx].to_vec();
            changes.insert(start_base, changed_lines);

            base_idx += 1;
        } else {
            base_idx += 1;
            mod_idx += 1;
        }
    }

    // Handle additions at end
    if mod_idx < modified.len() {
        changes.insert(base.len(), modified[mod_idx..].to_vec());
    }

    changes
}

/// Batch apply patches to multiple files
pub fn batch_apply_patches(
    files: Vec<(String, String, String)>, // (path, source, diff)
    options: &PatchOptions,
) -> HashMap<String, PatchResult> {
    files
        .into_iter()
        .filter_map(|(path, source, diff)| {
            let patch = parse_unified_diff(&diff).ok()?;
            let result = apply_patch(&source, &patch, options);
            Some((path, result))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_unified_diff() {
        let diff = r#"--- old.txt	2024-01-01 00:00:00.000000000 +0000
+++ new.txt	2024-01-01 00:00:00.000000000 +0000
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

        let patch = parse_unified_diff(diff).unwrap();
        assert_eq!(patch.hunks.len(), 1);
        assert_eq!(patch.hunks[0].old_start, 1);
        assert_eq!(patch.hunks[0].ops.len(), 3);
    }

    #[test]
    fn test_apply_patch_simple() {
        let source = "line1\nline2\nline3";
        let diff = r#"--- old.txt
+++ new.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

        let patch = parse_unified_diff(diff).unwrap();
        let options = PatchOptions::default();
        let result = apply_patch(source, &patch, &options);

        assert!(result.success);
        assert_eq!(result.content, "line1\nmodified\nline3");
        assert_eq!(result.applied_hunks, 1);
    }

    #[test]
    fn test_apply_patch_add_lines() {
        let source = "line1\nline2";
        let diff = r#"--- old.txt
+++ new.txt
@@ -1,2 +1,4 @@
 line1
+inserted1
+inserted2
 line2
"#;

        let patch = parse_unified_diff(diff).unwrap();
        let options = PatchOptions::default();
        let result = apply_patch(source, &patch, &options);

        assert!(result.success);
        assert!(result.content.contains("inserted1"));
        assert!(result.content.contains("inserted2"));
    }

    #[test]
    fn test_apply_patch_delete_lines() {
        let source = "line1\nline2\nline3\nline4";
        let diff = r#"--- old.txt
+++ new.txt
@@ -1,4 +1,2 @@
 line1
-line2
-line3
 line4
"#;

        let patch = parse_unified_diff(diff).unwrap();
        let options = PatchOptions::default();
        let result = apply_patch(source, &patch, &options);

        assert!(result.success);
        assert_eq!(result.content, "line1\nline4");
    }

    #[test]
    fn test_apply_patch_fuzzy() {
        let source = "line1\nline2\nline3\nline4\nline5";
        // Patch expects line2 at position 2, but we'll try fuzzy matching
        let diff = r#"--- old.txt
+++ new.txt
@@ -2,3 +2,3 @@
 line2
-line3
+modified
 line4
"#;

        let patch = parse_unified_diff(diff).unwrap();
        let options = PatchOptions {
            fuzzy: true,
            max_offset: 5,
            ..Default::default()
        };
        let result = apply_patch(source, &patch, &options);

        assert!(result.success);
        assert!(result.content.contains("modified"));
    }

    #[test]
    fn test_apply_patch_fuzzy_function() {
        let source = "line1\nline2\nline3";
        let diff = r#"--- old.txt
+++ new.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

        let result = apply_patch_fuzzy(source, diff).unwrap();

        assert!(result.success);
        assert_eq!(result.content, "line1\nmodified\nline3");
    }

    #[test]
    fn test_three_way_merge_no_conflict() {
        let base = "line1\nline2\nline3";
        let ours = "line1\nmodified\nline3";
        let theirs = "line1\nline2\nline3";

        let (merged, conflicts) = three_way_merge(base, ours, theirs);

        assert!(conflicts.is_empty());
        assert!(merged.contains("modified"));
    }

    #[test]
    fn test_three_way_merge_with_conflict() {
        let base = "line1\nline2\nline3";
        let ours = "line1\nours_change\nline3";
        let theirs = "line1\ntheirs_change\nline3";

        let (merged, conflicts) = three_way_merge(base, ours, theirs);

        assert_eq!(conflicts.len(), 1);
        assert!(merged.contains("<<<<<<< ours"));
        assert!(merged.contains("======="));
        assert!(merged.contains(">>>>>>> theirs"));
    }

    #[test]
    fn test_lines_match() {
        assert!(lines_match("hello", "hello", false));
        assert!(!lines_match("hello", "world", false));
        assert!(lines_match("  hello  ", "hello", true));
        assert!(!lines_match("  hello  ", "hello", false));
    }

    #[test]
    fn test_apply_patch_failure() {
        let source = "completely\ndifferent\ncontent";
        let diff = r#"--- old.txt
+++ new.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

        let patch = parse_unified_diff(diff).unwrap();
        let options = PatchOptions {
            fuzzy: false,
            ..Default::default()
        };
        let result = apply_patch(source, &patch, &options);

        assert!(!result.success);
        assert!(!result.failed_hunks.is_empty());
    }
}

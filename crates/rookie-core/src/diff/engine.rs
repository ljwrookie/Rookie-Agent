//! High-performance diff engine using the `similar` crate
//!
//! Features:
//! - Multiple diff algorithms: Myer's diff, patience, histogram
//! - Unified diff format output
//! - did_you_mean() fuzzy matching for suggestions
//! - Performance target: 10K lines < 10ms

use serde::{Deserialize, Serialize};
use similar::{algorithms::Algorithm as SimilarAlgorithm, ChangeTag, TextDiff};
use std::collections::HashMap;

/// Diff algorithm selection
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Algorithm {
    /// Standard Myer's diff algorithm
    Myers,
    /// Patience diff algorithm (better for code)
    Patience,
}

impl Default for Algorithm {
    fn default() -> Self {
        Algorithm::Patience
    }
}

impl From<Algorithm> for SimilarAlgorithm {
    fn from(alg: Algorithm) -> Self {
        match alg {
            Algorithm::Myers => SimilarAlgorithm::Myers,
            Algorithm::Patience => SimilarAlgorithm::Patience,
        }
    }
}

/// A single line-level diff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineDiff {
    pub tag: DiffTag,
    pub old_index: Option<usize>,
    pub new_index: Option<usize>,
    pub content: String,
}

/// Diff tag indicating the type of change
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DiffTag {
    Equal,
    Delete,
    Insert,
    Replace,
}

/// Diff computation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub lines: Vec<LineDiff>,
    pub additions: usize,
    pub deletions: usize,
    pub unchanged: usize,
    pub unified_diff: String,
    pub duration_ms: u64,
}

/// Options for diff computation
#[derive(Debug, Clone)]
pub struct DiffOptions {
    /// Diff algorithm to use
    pub algorithm: Algorithm,
    /// Context lines for unified diff
    pub context_lines: usize,
    /// Ignore whitespace changes
    pub ignore_whitespace: bool,
    /// Ignore case changes
    pub ignore_case: bool,
    /// Newline style ("\n" or "\r\n")
    pub newline_style: String,
}

impl Default for DiffOptions {
    fn default() -> Self {
        Self {
            algorithm: Algorithm::Patience,
            context_lines: 3,
            ignore_whitespace: false,
            ignore_case: false,
            newline_style: "\n".to_string(),
        }
    }
}

/// Compute diff between old and new text
///
/// # Performance
/// Target: 10K lines < 10ms using histogram algorithm
pub fn compute_diff(old_text: &str, new_text: &str, options: DiffOptions) -> DiffResult {
    let start = std::time::Instant::now();

    // Normalize newlines
    let old_normalized = normalize_newlines(old_text, &options.newline_style);
    let new_normalized = normalize_newlines(new_text, &options.newline_style);

    // Apply preprocessing if needed
    let (old_processed, new_processed) = if options.ignore_whitespace || options.ignore_case {
        (
            preprocess(&old_normalized, options.ignore_whitespace, options.ignore_case),
            preprocess(&new_normalized, options.ignore_whitespace, options.ignore_case),
        )
    } else {
        (old_normalized.clone(), new_normalized.clone())
    };

    // Compute diff using selected algorithm
    let diff = TextDiff::configure()
        .algorithm(options.algorithm.into())
        .diff_lines(&old_processed, &new_processed);

    let mut lines = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;
    let mut unchanged = 0;

    // Track line indices
    let mut old_line = 1usize;
    let mut new_line = 1usize;

    for group in diff.grouped_ops(options.context_lines) {
        for op in group {
            for change in diff.iter_changes(&op) {
                let tag = change.tag();
                let content = change.value().to_string();

                match tag {
                    ChangeTag::Equal => {
                        lines.push(LineDiff {
                            tag: DiffTag::Equal,
                            old_index: Some(old_line),
                            new_index: Some(new_line),
                            content,
                        });
                        old_line += 1;
                        new_line += 1;
                        unchanged += 1;
                    }
                    ChangeTag::Delete => {
                        lines.push(LineDiff {
                            tag: DiffTag::Delete,
                            old_index: Some(old_line),
                            new_index: None,
                            content,
                        });
                        old_line += 1;
                        deletions += 1;
                    }
                    ChangeTag::Insert => {
                        lines.push(LineDiff {
                            tag: DiffTag::Insert,
                            old_index: None,
                            new_index: Some(new_line),
                            content,
                        });
                        new_line += 1;
                        additions += 1;
                    }
                }
            }
        }
    }

    // Generate unified diff format
    let unified_diff = generate_unified_diff(
        &old_normalized,
        &new_normalized,
        &diff,
        options.context_lines,
    );

    let duration_ms = start.elapsed().as_millis() as u64;

    DiffResult {
        lines,
        additions,
        deletions,
        unchanged,
        unified_diff,
        duration_ms,
    }
}

/// Compute character-level diff for inline changes
pub fn compute_inline_diff(old_text: &str, new_text: &str) -> Vec<InlineChange> {
    let diff = TextDiff::from_chars(old_text, new_text);
    let mut changes = Vec::new();

    for group in diff.grouped_ops(0) {
        for op in group {
            for change in diff.iter_changes(&op) {
                changes.push(InlineChange {
                    tag: match change.tag() {
                        ChangeTag::Equal => DiffTag::Equal,
                        ChangeTag::Delete => DiffTag::Delete,
                        ChangeTag::Insert => DiffTag::Insert,
                    },
                    value: change.value().to_string(),
                });
            }
        }
    }

    changes
}

/// Inline change for character-level diff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineChange {
    pub tag: DiffTag,
    pub value: String,
}

/// Generate unified diff format output
fn generate_unified_diff(
    old_text: &str,
    new_text: &str,
    diff: &TextDiff<str>,
    context_lines: usize,
) -> String {
    let mut output = String::new();

    // Add header
    output.push_str("--- old\n");
    output.push_str("+++ new\n");

    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();

    for group in diff.grouped_ops(context_lines) {
        // Calculate hunk range
        let (old_start, old_len) = calculate_hunk_range(&group, &old_lines, true);
        let (new_start, new_len) = calculate_hunk_range(&group, &new_lines, false);

        output.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            old_start, old_len, new_start, new_len
        ));

        for op in group {
            for change in diff.iter_changes(&op) {
                let prefix = match change.tag() {
                    ChangeTag::Equal => " ",
                    ChangeTag::Delete => "-",
                    ChangeTag::Insert => "+",
                };
                for line in change.value().lines() {
                    output.push_str(prefix);
                    output.push_str(line);
                    output.push('\n');
                }
            }
        }
    }

    output
}

/// Calculate hunk range for unified diff
fn calculate_hunk_range<T>(
    group: &[similar::DiffOp],
    _lines: &[T],
    is_old: bool,
) -> (usize, usize) {
    let mut start = usize::MAX;
    let mut end = 0;

    for op in group {
        let (range_start, range_end) = match op {
            similar::DiffOp::Equal { old_index, new_index, len } => {
                if is_old {
                    (*old_index, old_index + len)
                } else {
                    (*new_index, new_index + len)
                }
            }
            similar::DiffOp::Delete { old_index, old_len, .. } => {
                if is_old {
                    (*old_index, old_index + old_len)
                } else {
                    continue;
                }
            }
            similar::DiffOp::Insert { new_index, new_len, .. } => {
                if is_old {
                    continue;
                } else {
                    (*new_index, new_index + new_len)
                }
            }
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                if is_old {
                    (*old_index, old_index + old_len)
                } else {
                    (*new_index, new_index + new_len)
                }
            }
        };

        start = start.min(range_start);
        end = end.max(range_end);
    }

    if start == usize::MAX {
        start = 0;
    }

    let len = if end > start { end - start } else { 0 };
    (start + 1, len) // 1-indexed
}

/// Normalize newlines in text
fn normalize_newlines(text: &str, style: &str) -> String {
    if style == "\n" {
        text.replace("\r\n", "\n")
    } else {
        text.replace("\n", "\r\n").replace("\r\r\n", "\r\n")
    }
}

/// Preprocess text for comparison
fn preprocess(text: &str, ignore_whitespace: bool, ignore_case: bool) -> String {
    let mut result = text.to_string();

    if ignore_whitespace {
        result = result
            .lines()
            .map(|line| line.trim())
            .collect::<Vec<_>>()
            .join("\n");
    }

    if ignore_case {
        result = result.to_lowercase();
    }

    result
}

/// Fuzzy matching: suggest similar strings from candidates
///
/// Uses Levenshtein distance to find the closest match
pub fn did_you_mean(input: &str, candidates: &[String]) -> Option<(String, usize)> {
    if candidates.is_empty() {
        return None;
    }

    let mut best_match: Option<(String, usize)> = None;
    let mut best_distance = usize::MAX;

    for candidate in candidates {
        let distance = levenshtein_distance(input, candidate);
        if distance < best_distance {
            best_distance = distance;
            best_match = Some((candidate.clone(), distance));
        }
    }

    // Only return if similarity is reasonable (< 50% different)
    if best_distance <= input.len() / 2 {
        best_match
    } else {
        None
    }
}

/// Calculate Levenshtein distance between two strings
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    for i in 0..=a_len {
        matrix[i][0] = i;
    }
    for j in 0..=b_len {
        matrix[0][j] = j;
    }

    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a_len][b_len]
}

/// Find similar lines in text for fuzzy patching
pub fn find_similar_line(target: &str, candidates: &[&str], threshold: f64) -> Option<usize> {
    let mut best_idx = None;
    let mut best_score = threshold;

    for (idx, candidate) in candidates.iter().enumerate() {
        let distance = levenshtein_distance(target, candidate) as f64;
        let max_len = target.len().max(candidate.len()) as f64;
        let similarity = 1.0 - (distance / max_len);

        if similarity > best_score {
            best_score = similarity;
            best_idx = Some(idx);
        }
    }

    best_idx
}

/// Compute word-level diff for better readability
pub fn compute_word_diff(old_text: &str, new_text: &str) -> Vec<WordDiff> {
    let old_words: Vec<&str> = old_text.split_whitespace().collect();
    let new_words: Vec<&str> = new_text.split_whitespace().collect();

    let diff = TextDiff::from_slices(&old_words, &new_words);
    let mut result = Vec::new();

    for group in diff.grouped_ops(0) {
        for op in group {
            for change in diff.iter_changes(&op) {
                result.push(WordDiff {
                    tag: match change.tag() {
                        ChangeTag::Equal => DiffTag::Equal,
                        ChangeTag::Delete => DiffTag::Delete,
                        ChangeTag::Insert => DiffTag::Insert,
                    },
                    value: change.value().to_string(),
                });
            }
        }
    }

    result
}

/// Word-level diff result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordDiff {
    pub tag: DiffTag,
    pub value: String,
}

/// Batch diff multiple files
pub fn batch_diff(
    files: Vec<(String, String, String)>, // (path, old_content, new_content)
    options: DiffOptions,
) -> HashMap<String, DiffResult> {
    files
        .into_iter()
        .map(|(path, old, new)| {
            let result = compute_diff(&old, &new, options.clone());
            (path, result)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_diff_basic() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";

        let result = compute_diff(old, new, DiffOptions::default());

        assert_eq!(result.deletions, 1);
        assert_eq!(result.additions, 1);
        assert!(result.unified_diff.contains("-line2"));
        assert!(result.unified_diff.contains("+modified"));
    }

    #[test]
    fn test_compute_diff_additions() {
        let old = "line1\nline2";
        let new = "line1\nline2\nline3\nline4";

        let result = compute_diff(old, new, DiffOptions::default());

        assert_eq!(result.additions, 2);
        assert_eq!(result.deletions, 0);
    }

    #[test]
    fn test_compute_diff_deletions() {
        let old = "line1\nline2\nline3";
        let new = "line1";

        let result = compute_diff(old, new, DiffOptions::default());

        assert_eq!(result.deletions, 2);
        assert_eq!(result.additions, 0);
    }

    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("a", ""), 1);
        assert_eq!(levenshtein_distance("", "a"), 1);
        assert_eq!(levenshtein_distance("hello", "hello"), 0);
    }

    #[test]
    fn test_did_you_mean() {
        let candidates = vec![
            "hello".to_string(),
            "world".to_string(),
            "help".to_string(),
        ];

        assert_eq!(did_you_mean("helo", &candidates), Some(("hello".to_string(), 1)));
        assert_eq!(did_you_mean("xyz", &candidates), None);
    }

    #[test]
    fn test_normalize_newlines() {
        assert_eq!(normalize_newlines("a\r\nb", "\n"), "a\nb");
        assert_eq!(normalize_newlines("a\nb", "\r\n"), "a\r\nb");
    }

    #[test]
    fn test_find_similar_line() {
        let candidates = vec!["hello world", "foo bar", "baz qux"];
        let candidates_ref: Vec<&str> = candidates.iter().map(|s| *s).collect();

        assert_eq!(find_similar_line("hello worlds", &candidates_ref, 0.5), Some(0));
        assert_eq!(find_similar_line("completely different", &candidates_ref, 0.5), None);
    }

    #[test]
    fn test_compute_inline_diff() {
        let old = "abc";
        let new = "aXc";

        let result = compute_inline_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].tag, DiffTag::Equal));
        assert!(matches!(result[1].tag, DiffTag::Replace));
        assert!(matches!(result[2].tag, DiffTag::Equal));
    }
}

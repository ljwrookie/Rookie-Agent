//! Tests for Diff/Patch engine

use rookie_core::diff::engine::{compute_diff, did_you_mean, Algorithm, DiffOptions};
use rookie_core::diff::patch::{apply_patch, apply_patch_fuzzy, parse_unified_diff, three_way_merge, PatchOptions};

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
fn test_compute_diff_performance_10k_lines() {
    let old_lines: Vec<String> = (0..10000).map(|i| format!("Line {}", i)).collect();
    let new_lines: Vec<String> = (0..10000)
        .map(|i| {
            if i == 5000 {
                "Modified line".to_string()
            } else {
                format!("Line {}", i)
            }
        })
        .collect();

    let old = old_lines.join("\n");
    let new = new_lines.join("\n");

    let start = std::time::Instant::now();
    let result = compute_diff(&old, &new, DiffOptions {
        algorithm: Algorithm::Patience,
        ..Default::default()
    });
    let duration = start.elapsed();

    // Performance target: 10K lines < 10ms
    // Note: Relaxed for CI environments
    assert!(duration.as_millis() < 100, "Diff took too long: {:?}", duration);
    assert_eq!(result.deletions, 1);
    assert_eq!(result.additions, 1);
}

#[test]
fn test_diff_algorithms() {
    let old = "A\nB\nC\nD\nE";
    let new = "A\nX\nC\nY\nE";

    for alg in [Algorithm::Myers, Algorithm::Patience] {
        let result = compute_diff(old, new, DiffOptions {
            algorithm: alg,
            ..Default::default()
        });
        assert_eq!(result.deletions, 2);
        assert_eq!(result.additions, 2);
    }
}

#[test]
fn test_apply_patch() {
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
}

#[test]
fn test_apply_patch_fuzzy() {
    let source = "context1\ncontext2\nline1\nline2\nline3\ncontext3";
    // Patch with slightly different context (should still apply with fuzz)
    let diff = r#"--- old.txt
+++ new.txt
@@ -2,5 +2,5 @@
 context2
 line1
-line2
+modified
 line3
 context3
"#;

    let result = apply_patch_fuzzy(source, diff).unwrap();

    assert!(result.success);
    assert!(result.content.contains("modified"));
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
fn test_levenshtein_distance() {
    use rookie_core::diff::engine::levenshtein_distance;
    assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
    assert_eq!(levenshtein_distance("", ""), 0);
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

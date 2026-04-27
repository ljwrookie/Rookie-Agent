//! Smoke tests for the tantivy-backed FileIndex: build a tiny project
//! in a temp dir and verify that search returns the correct file.

use rookie_core::index::FileIndex;
use std::fs;

fn mkdir_tmp() -> std::path::PathBuf {
    let base = std::env::temp_dir().join(format!("rookie-index-smoke-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(&base).unwrap();
    base
}

#[test]
fn build_and_search_finds_seeded_content() {
    let root = mkdir_tmp();

    // Seed files
    fs::write(root.join("alpha.ts"), "export const pineappleFlag = true;").unwrap();
    fs::write(root.join("beta.md"), "# README\nUnrelated file.").unwrap();

    let mut idx = FileIndex::new(&root);
    let count = idx.build().expect("build index");
    assert!(count >= 2, "expected at least 2 indexed files, got {count}");

    let hits = idx.search("pineappleFlag", 10).expect("search ok");
    assert!(!hits.is_empty(), "should find the seeded keyword");
    assert!(hits[0].path.ends_with("alpha.ts"), "top hit should be alpha.ts, got {}", hits[0].path);
}

#[test]
fn search_without_build_errors() {
    let root = mkdir_tmp();
    let idx = FileIndex::new(&root);
    let err = idx.search("whatever", 5);
    assert!(err.is_err(), "search before build must error");
}

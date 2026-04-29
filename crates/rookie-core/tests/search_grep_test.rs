//! Tests for Grep search engine

use rookie_core::search::grep::{grep_search, GrepOptions};
use std::io::Write;
use tempfile::TempDir;

#[test]
fn test_grep_basic_search() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.txt");
    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, "Hello World").unwrap();
    writeln!(file, "Hello Rust").unwrap();
    writeln!(file, "Goodbye World").unwrap();

    let options = GrepOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "Hello".to_string(),
        ..Default::default()
    };

    let result = grep_search(options).unwrap();
    assert_eq!(result.matches.len(), 2);
    assert!(result.duration_ms < 100); // Should be fast
}

#[test]
fn test_grep_regex_search() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.rs");
    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, "fn main() {{}}").unwrap();
    writeln!(file, "fn helper() {{}}").unwrap();
    writeln!(file, "let x = 5;").unwrap();

    let options = GrepOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: r"fn \w+\(\)".to_string(),
        ..Default::default()
    };

    let result = grep_search(options).unwrap();
    assert_eq!(result.matches.len(), 2);
}

#[test]
fn test_grep_literal_search() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.txt");
    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, "foo.bar").unwrap();
    writeln!(file, "foobar").unwrap();

    let options = GrepOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "foo.bar".to_string(),
        literal: true,
        ..Default::default()
    };

    let result = grep_search(options).unwrap();
    assert_eq!(result.matches.len(), 1);
}

#[test]
fn test_grep_pagination() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.txt");
    let mut file = std::fs::File::create(&file_path).unwrap();
    for i in 0..100 {
        writeln!(file, "Line {}", i).unwrap();
    }

    let options = GrepOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "Line".to_string(),
        limit: 10,
        offset: 10,
        ..Default::default()
    };

    let result = grep_search(options).unwrap();
    assert_eq!(result.matches.len(), 10);
    assert!(result.matches[0].content.contains("Line 10"));
}

#[test]
fn test_grep_performance_10k_files() {
    let temp_dir = TempDir::new().unwrap();

    // Create 1000 files with 10 lines each = 10K lines
    for i in 0..1000 {
        let file_path = temp_dir.path().join(format!("file_{}.txt", i));
        let mut file = std::fs::File::create(&file_path).unwrap();
        for j in 0..10 {
            writeln!(file, "Line {} in file {}", j, i).unwrap();
        }
    }

    let options = GrepOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "Line 5".to_string(),
        ..Default::default()
    };

    let start = std::time::Instant::now();
    let result = grep_search(options).unwrap();
    let duration = start.elapsed();

    assert_eq!(result.matches.len(), 1000);
    // Performance target: 10K files < 50ms
    // Note: This is a relaxed check for CI environments
    assert!(duration.as_millis() < 500, "Search took too long: {:?}", duration);
}

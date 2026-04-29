//! Tests for Glob matching engine

use rookie_core::search::glob::{glob_match, GlobOptions};
use std::fs;
use tempfile::TempDir;

#[test]
fn test_glob_basic_pattern() {
    let temp_dir = TempDir::new().unwrap();
    fs::create_dir(temp_dir.path().join("src")).unwrap();
    fs::File::create(temp_dir.path().join("src/main.ts")).unwrap();
    fs::File::create(temp_dir.path().join("src/lib.ts")).unwrap();
    fs::File::create(temp_dir.path().join("test.js")).unwrap();

    let options = GlobOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "src/**/*.ts".to_string(),
        ..Default::default()
    };

    let result = glob_match(options).unwrap();
    assert_eq!(result.len(), 2);
}

#[test]
fn test_glob_star_pattern() {
    let temp_dir = TempDir::new().unwrap();
    fs::File::create(temp_dir.path().join("a.ts")).unwrap();
    fs::File::create(temp_dir.path().join("b.ts")).unwrap();
    fs::File::create(temp_dir.path().join("c.js")).unwrap();

    let options = GlobOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "*.ts".to_string(),
        ..Default::default()
    };

    let result = glob_match(options).unwrap();
    assert_eq!(result.len(), 2);
}

#[test]
fn test_glob_alternation() {
    let temp_dir = TempDir::new().unwrap();
    fs::File::create(temp_dir.path().join("a.ts")).unwrap();
    fs::File::create(temp_dir.path().join("b.js")).unwrap();
    fs::File::create(temp_dir.path().join("c.rs")).unwrap();

    let options = GlobOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "*.{ts,js}".to_string(),
        ..Default::default()
    };

    let result = glob_match(options).unwrap();
    assert_eq!(result.len(), 2);
}

#[test]
fn test_glob_pagination() {
    let temp_dir = TempDir::new().unwrap();
    for i in 0..100 {
        fs::File::create(temp_dir.path().join(format!("file{}.txt", i))).unwrap();
    }

    let options = GlobOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "*.txt".to_string(),
        limit: 10,
        offset: 10,
        ..Default::default()
    };

    let result = glob_match(options).unwrap();
    assert_eq!(result.len(), 10);
}

#[test]
fn test_glob_respects_gitignore() {
    let temp_dir = TempDir::new().unwrap();

    // Create .gitignore
    fs::write(temp_dir.path().join(".gitignore"), "ignored/\n").unwrap();

    // Create files
    fs::create_dir(temp_dir.path().join("src")).unwrap();
    fs::create_dir(temp_dir.path().join("ignored")).unwrap();
    fs::File::create(temp_dir.path().join("src/main.ts")).unwrap();
    fs::File::create(temp_dir.path().join("ignored/file.ts")).unwrap();

    let options = GlobOptions {
        path: temp_dir.path().to_path_buf(),
        pattern: "**/*.ts".to_string(),
        ..Default::default()
    };

    let result = glob_match(options).unwrap();
    assert_eq!(result.len(), 1); // Only src/main.ts, not ignored/file.ts
}

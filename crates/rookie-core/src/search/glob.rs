//! High-performance glob matching engine using globset
//!
//! Features:
//! - Full glob syntax support (**/*, {a,b}, ?, [!...])
//! - Parallel matching with rayon
//! - Automatic ignore handling
//! - Performance optimized for large file sets

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A glob match result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobMatchResult {
    pub path: String,
    pub is_file: bool,
    pub is_dir: bool,
}

/// Glob matching options
#[derive(Debug, Clone)]
pub struct GlobOptions {
    /// Root directory to search
    pub path: PathBuf,
    /// Glob pattern to match
    pub pattern: String,
    /// Maximum number of results
    pub limit: usize,
    /// Number of results to skip (pagination)
    pub offset: usize,
    /// Follow symlinks
    pub follow_symlinks: bool,
    /// Include hidden files
    pub hidden: bool,
    /// Custom ignore patterns
    pub ignore_patterns: Vec<String>,
    /// Match directories as well as files
    pub match_dirs: bool,
}

impl Default for GlobOptions {
    fn default() -> Self {
        Self {
            path: PathBuf::from("."),
            pattern: String::new(),
            limit: 500,
            offset: 0,
            follow_symlinks: false,
            hidden: false,
            ignore_patterns: Vec::new(),
            match_dirs: false,
        }
    }
}

/// Perform glob matching with the given options
///
/// # Performance
/// Uses rayon for parallel matching. Handles 10K+ files efficiently.
pub fn glob_match(options: GlobOptions) -> anyhow::Result<Vec<GlobMatchResult>> {
    // Build glob matcher
    let glob = Glob::new(&options.pattern)?;
    let matcher = glob.compile_matcher();

    // Collect entries using ignore crate
    let entries = collect_entries(&options)?;

    // Parallel matching
    let results: Vec<GlobMatchResult> = entries
        .par_iter()
        .filter_map(|(path, is_file, is_dir)| {
            let relative = path.strip_prefix(&options.path).unwrap_or(path);
            if matcher.is_match(relative) {
                Some(GlobMatchResult {
                    path: relative.to_string_lossy().to_string(),
                    is_file: *is_file,
                    is_dir: *is_dir,
                })
            } else {
                None
            }
        })
        .collect();

    // Apply offset and limit
    let paginated: Vec<GlobMatchResult> = results
        .into_iter()
        .skip(options.offset)
        .take(options.limit)
        .collect();

    Ok(paginated)
}

/// Collect file entries respecting ignore patterns
fn collect_entries(options: &GlobOptions) -> anyhow::Result<Vec<(PathBuf, bool, bool)>> {
    let mut builder = WalkBuilder::new(&options.path);

    // Configure ignore handling
    builder.add_custom_ignore_filename(".gitignore");
    builder.add_custom_ignore_filename(".rookieignore");
    builder.add_custom_ignore_filename(".ignore");

    // Add custom ignore patterns
    for pattern in &options.ignore_patterns {
        builder.add_ignore(pattern);
    }

    // Configure options
    builder.hidden(!options.hidden);
    builder.follow_links(options.follow_symlinks);

    // Collect entries
    let entries: Vec<(PathBuf, bool, bool)> = builder
        .build()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let ft = entry.file_type();
            match ft {
                Some(ft) if ft.is_file() => true,
                Some(ft) if ft.is_dir() && options.match_dirs => true,
                _ => false,
            }
        })
        .map(|entry| {
            let ft = entry.file_type().unwrap();
            (
                entry.path().to_path_buf(),
                ft.is_file(),
                ft.is_dir(),
            )
        })
        .collect();

    Ok(entries)
}

/// Match multiple glob patterns at once
pub fn glob_match_multi(
    patterns: Vec<String>,
    options: GlobOptions,
) -> anyhow::Result<Vec<Vec<GlobMatchResult>>> {
    patterns
        .into_par_iter()
        .map(|pattern| {
            let mut opts = options.clone();
            opts.pattern = pattern;
            glob_match(opts)
        })
        .collect()
}

/// Build a GlobSet from multiple patterns for efficient matching
pub fn build_glob_set(patterns: &[String]) -> anyhow::Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = Glob::new(pattern)?;
        builder.add(glob);
    }
    Ok(builder.build()?)
}

/// Check if a path matches any of the given patterns
pub fn path_matches_any(path: &Path, patterns: &[String]) -> anyhow::Result<bool> {
    let glob_set = build_glob_set(patterns)?;
    Ok(glob_set.is_match(path))
}

/// Extended glob matching with negation support
///
/// Supports patterns like:
/// - `src/**/*.ts` - match TypeScript files in src
/// - `!**/*.test.ts` - exclude test files
/// - `{a,b}/**/*.js` - match in a or b directories
pub fn glob_match_with_negation(
    include: Vec<String>,
    exclude: Vec<String>,
    options: GlobOptions,
) -> anyhow::Result<Vec<GlobMatchResult>> {
    // Build include and exclude matchers
    let include_set = build_glob_set(&include)?;
    let exclude_set = build_glob_set(&exclude)?;

    // Collect entries
    let entries = collect_entries(&options)?;

    // Apply filters
    let results: Vec<GlobMatchResult> = entries
        .par_iter()
        .filter_map(|(path, is_file, is_dir)| {
            let relative = path.strip_prefix(&options.path).unwrap_or(path);

            // Must match include and not match exclude
            if include_set.is_match(relative) && !exclude_set.is_match(relative) {
                Some(GlobMatchResult {
                    path: relative.to_string_lossy().to_string(),
                    is_file: *is_file,
                    is_dir: *is_dir,
                })
            } else {
                None
            }
        })
        .collect();

    // Apply offset and limit
    let paginated: Vec<GlobMatchResult> = results
        .into_iter()
        .skip(options.offset)
        .take(options.limit)
        .collect();

    Ok(paginated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_glob_match_basic() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir(temp_dir.path().join("src")).unwrap();
        std::fs::File::create(temp_dir.path().join("src/main.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("src/lib.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("test.js")).unwrap();

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "src/**/*.ts".to_string(),
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|r| r.path.ends_with(".ts")));
    }

    #[test]
    fn test_glob_match_star() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::File::create(temp_dir.path().join("a.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("b.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("c.js")).unwrap();

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "*.ts".to_string(),
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_glob_match_alternation() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::File::create(temp_dir.path().join("a.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("b.js")).unwrap();
        std::fs::File::create(temp_dir.path().join("c.rs")).unwrap();

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "*.{ts,js}".to_string(),
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_glob_match_limit() {
        let temp_dir = TempDir::new().unwrap();
        for i in 0..100 {
            std::fs::File::create(temp_dir.path().join(format!("file{}.txt", i))).unwrap();
        }

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "*.txt".to_string(),
            limit: 10,
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert_eq!(result.len(), 10);
    }

    #[test]
    fn test_glob_match_offset() {
        let temp_dir = TempDir::new().unwrap();
        for i in 0..20 {
            std::fs::File::create(temp_dir.path().join(format!("file{:02}.txt", i))).unwrap();
        }

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "*.txt".to_string(),
            offset: 10,
            limit: 10,
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert_eq!(result.len(), 10);
    }

    #[test]
    fn test_glob_match_with_negation() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::File::create(temp_dir.path().join("a.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("b.test.ts")).unwrap();
        std::fs::File::create(temp_dir.path().join("c.ts")).unwrap();

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let result = glob_match_with_negation(
            vec!["*.ts".to_string()],
            vec!["*.test.ts".to_string()],
            options,
        )
        .unwrap();

        assert_eq!(result.len(), 2);
        assert!(!result.iter().any(|r| r.path.contains("test")));
    }

    #[test]
    fn test_build_glob_set() {
        let patterns = vec!["*.ts".to_string(), "*.js".to_string()];
        let glob_set = build_glob_set(&patterns).unwrap();

        assert!(glob_set.is_match("file.ts"));
        assert!(glob_set.is_match("file.js"));
        assert!(!glob_set.is_match("file.rs"));
    }

    #[test]
    fn test_path_matches_any() {
        let patterns = vec!["*.ts".to_string(), "*.js".to_string()];

        assert!(path_matches_any(Path::new("test.ts"), &patterns).unwrap());
        assert!(path_matches_any(Path::new("test.js"), &patterns).unwrap());
        assert!(!path_matches_any(Path::new("test.rs"), &patterns).unwrap());
    }

    #[test]
    fn test_glob_match_dirs() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir(temp_dir.path().join("src")).unwrap();
        std::fs::create_dir(temp_dir.path().join("tests")).unwrap();
        std::fs::File::create(temp_dir.path().join("file.txt")).unwrap();

        let options = GlobOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "*".to_string(),
            match_dirs: true,
            ..Default::default()
        };

        let result = glob_match(options).unwrap();
        assert!(result.iter().any(|r| r.is_dir));
        assert!(result.iter().any(|r| r.is_file));
    }
}

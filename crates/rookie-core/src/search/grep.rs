//! High-performance grep search engine using grep-searcher and rayon
//!
//! Features:
//! - Regex and literal search modes
//! - Multi-pattern support
//! - Automatic .gitignore / .rookieignore handling
//! - Parallel search with rayon threadpool
//! - Performance target: 10K files < 50ms

use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::SearcherBuilder;
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A single match found in a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Match {
    pub path: String,
    pub line: usize,
    pub content: String,
    pub column: Option<usize>,
}

/// Grep search results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepResult {
    pub matches: Vec<Match>,
    pub files_searched: usize,
    pub duration_ms: u64,
}

/// Search options for grep
#[derive(Debug, Clone)]
pub struct GrepOptions {
    /// Root directory to search
    pub path: PathBuf,
    /// Regex pattern to search for
    pub pattern: String,
    /// File glob filter (e.g., "**/*.ts")
    pub glob: Option<String>,
    /// Output format: "content" or "files"
    pub output: String,
    /// Maximum number of matches
    pub limit: usize,
    /// Number of matches to skip (pagination)
    pub offset: usize,
    /// Case insensitive search
    pub case_insensitive: bool,
    /// Use literal search instead of regex
    pub literal: bool,
    /// Multi-line mode
    pub multiline: bool,
    /// Maximum file size to search (bytes)
    pub max_file_size: Option<usize>,
    /// Custom ignore patterns
    pub ignore_patterns: Vec<String>,
}

impl Default for GrepOptions {
    fn default() -> Self {
        Self {
            path: PathBuf::from("."),
            pattern: String::new(),
            glob: None,
            output: "content".to_string(),
            limit: 200,
            offset: 0,
            case_insensitive: true,
            literal: false,
            multiline: false,
            max_file_size: Some(2 * 1024 * 1024), // 2MB default
            ignore_patterns: Vec::new(),
        }
    }
}

/// Perform a grep search with the given options
///
/// # Performance
/// Uses rayon for parallel file processing. Target: 10K files < 50ms
pub fn grep_search(options: GrepOptions) -> anyhow::Result<GrepResult> {
    let start = std::time::Instant::now();

    // Build the matcher
    let mut pattern = options.pattern.clone();
    if options.case_insensitive && !options.multiline && !options.literal {
        pattern = format!("(?i){}", pattern);
    }
    let matcher = RegexMatcher::new(&pattern)?;

    // Collect files to search using ignore crate
    let files = collect_files(&options)?;
    let files_searched = files.len();

    // Parallel search using rayon
    let matches = Arc::new(Mutex::new(Vec::new()));
    let limit = options.limit;
    let offset = options.offset;

    files.par_iter().try_for_each(|file| -> anyhow::Result<()> {
        // Check if we've collected enough matches
        {
            let current = matches.lock().unwrap();
            if current.len() >= limit + offset {
                return Ok(());
            }
        }

        search_file(file, &matcher, &options, &matches)?;
        Ok(())
    })?;

    // Extract and sort matches
    let mut all_matches = Arc::try_unwrap(matches)
        .unwrap()
        .into_inner()
        .unwrap();

    // Sort by path then line number for consistent output
    all_matches.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.line.cmp(&b.line))
    });

    // Apply offset and limit
    let paginated: Vec<Match> = all_matches
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(GrepResult {
        matches: paginated,
        files_searched,
        duration_ms,
    })
}

/// Collect files to search, respecting ignore patterns
fn collect_files(options: &GrepOptions) -> anyhow::Result<Vec<PathBuf>> {
    let mut builder = WalkBuilder::new(&options.path);

    // Add standard ignore files
    builder.add_custom_ignore_filename(".gitignore");
    builder.add_custom_ignore_filename(".rookieignore");
    builder.add_custom_ignore_filename(".ignore");

    // Add custom ignore patterns
    for pattern in &options.ignore_patterns {
        builder.add_ignore(pattern);
    }

    // Respect hidden files setting
    builder.hidden(false);

    // Apply glob filter if provided
    if let Some(ref glob) = options.glob {
        let globset = globset::Glob::new(glob)?.compile_matcher();
        let path_clone = options.path.clone();
        builder.filter_entry(move |entry| {
            let path = entry.path();
            let relative = path.strip_prefix(&path_clone).unwrap_or(path);
            globset.is_match(relative)
        });
    }

    // Collect files
    let walk = builder.build();
    let mut files: Vec<PathBuf> = Vec::new();

    for result in walk {
        if let Ok(entry) = result {
            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                // Check file size limit
                if let Some(max_size) = options.max_file_size {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.len() > max_size as u64 {
                            continue;
                        }
                    }
                }
                files.push(entry.path().to_path_buf());
            }
        }
    }

    Ok(files)
}

/// Search a single file for matches
fn search_file(
    path: &Path,
    matcher: &RegexMatcher,
    options: &GrepOptions,
    matches: &Arc<Mutex<Vec<Match>>>,
) -> anyhow::Result<()> {
    let _path_str = path.to_string_lossy().to_string();
    let base_path = options.path.clone();

    // Skip binary files by extension
    if is_binary_file(path) {
        return Ok(());
    }

    let mut searcher = SearcherBuilder::new()
        .binary_detection(grep_searcher::BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let mut sink = UTF8(|line_num, line| {
        // Find column (optional)
        let column = if options.literal {
            line.find(&options.pattern).map(|i| i + 1)
        } else {
            None
        };

        let relative_path = path
            .strip_prefix(&base_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let m = Match {
            path: relative_path,
            line: line_num as usize,
            content: line.to_string(),
            column,
        };

        let mut guard = matches.lock().unwrap();
        guard.push(m);

        Ok(true) // Continue searching
    });

    // Ignore errors (e.g., permission denied)
    let _ = searcher.search_path(matcher, path, &mut sink);

    Ok(())
}

/// Check if a file is likely binary by extension
fn is_binary_file(path: &Path) -> bool {
    let binary_extensions: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "svg",
        "pdf", "zip", "tar", "gz", "bz2", "7z", "rar",
        "exe", "dll", "so", "dylib", "bin",
        "lock", "sum", "mod", "node",
    ];

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| binary_extensions.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Multi-pattern grep search for multiple patterns at once
pub fn grep_search_multi(
    patterns: Vec<String>,
    options: GrepOptions,
) -> anyhow::Result<Vec<GrepResult>> {
    patterns
        .into_par_iter()
        .map(|pattern| {
            let mut opts = options.clone();
            opts.pattern = pattern;
            grep_search(opts)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_grep_search_basic() {
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
        assert!(result.matches.iter().all(|m| m.content.contains("Hello")));
    }

    #[test]
    fn test_grep_search_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(file, "HELLO world").unwrap();
        writeln!(file, "hello RUST").unwrap();

        let options = GrepOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "hello".to_string(),
            case_insensitive: true,
            ..Default::default()
        };

        let result = grep_search(options).unwrap();
        assert_eq!(result.matches.len(), 2);
    }

    #[test]
    fn test_grep_search_regex() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let mut file = std::fs::File::create(&file_path).unwrap();
        writeln!(file, "foo123bar").unwrap();
        writeln!(file, "foo456bar").unwrap();
        writeln!(file, "foobar").unwrap();

        let options = GrepOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: r"foo\d+bar".to_string(),
            ..Default::default()
        };

        let result = grep_search(options).unwrap();
        assert_eq!(result.matches.len(), 2);
    }

    #[test]
    fn test_grep_search_limit() {
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
            ..Default::default()
        };

        let result = grep_search(options).unwrap();
        assert_eq!(result.matches.len(), 10);
    }

    #[test]
    fn test_grep_search_offset() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let mut file = std::fs::File::create(&file_path).unwrap();
        for i in 0..20 {
            writeln!(file, "Line {}", i).unwrap();
        }

        let options = GrepOptions {
            path: temp_dir.path().to_path_buf(),
            pattern: "Line".to_string(),
            offset: 10,
            limit: 10,
            ..Default::default()
        };

        let result = grep_search(options).unwrap();
        assert_eq!(result.matches.len(), 10);
        assert!(result.matches[0].content.contains("Line 10"));
    }

    #[test]
    fn test_is_binary_file() {
        assert!(is_binary_file(Path::new("test.png")));
        assert!(is_binary_file(Path::new("test.jpg")));
        assert!(is_binary_file(Path::new("test.pdf")));
        assert!(!is_binary_file(Path::new("test.txt")));
        assert!(!is_binary_file(Path::new("test.rs")));
    }
}

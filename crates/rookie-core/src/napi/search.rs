//! NAPI-RS bindings for search engines

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use crate::search::{glob as glob_engine, grep as grep_engine};

// =============================================================================
// Grep Search Bindings
// =============================================================================

/// A single grep match
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepMatch {
    pub path: String,
    pub line: u32,
    pub content: String,
    pub column: Option<u32>,
}

/// Grep search results
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepSearchResult {
    pub matches: Vec<GrepMatch>,
    pub files_searched: u32,
    pub duration_ms: u64,
}

/// Options for grep search
#[napi(object)]
#[derive(Debug, Clone)]
pub struct GrepSearchOptions {
    pub path: String,
    pub pattern: String,
    pub glob: Option<String>,
    pub output: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub case_insensitive: Option<bool>,
    pub literal: Option<bool>,
    pub multiline: Option<bool>,
    pub max_file_size: Option<u32>,
    pub ignore_patterns: Option<Vec<String>>,
}

impl From<GrepSearchOptions> for grep_engine::GrepOptions {
    fn from(opts: GrepSearchOptions) -> Self {
        Self {
            path: std::path::PathBuf::from(opts.path),
            pattern: opts.pattern,
            glob: opts.glob,
            output: opts.output.unwrap_or_else(|| "content".to_string()),
            limit: opts.limit.map(|l| l as usize).unwrap_or(200),
            offset: opts.offset.map(|o| o as usize).unwrap_or(0),
            case_insensitive: opts.case_insensitive.unwrap_or(true),
            literal: opts.literal.unwrap_or(false),
            multiline: opts.multiline.unwrap_or(false),
            max_file_size: opts.max_file_size.map(|s| s as usize),
            ignore_patterns: opts.ignore_patterns.unwrap_or_default(),
        }
    }
}

/// Perform a grep search
#[napi]
pub fn grep_search(options: GrepSearchOptions) -> Result<GrepSearchResult> {
    let opts: grep_engine::GrepOptions = options.into();

    let result = grep_engine::grep_search(opts)
        .map_err(|e| Error::from_reason(format!("Grep search failed: {}", e)))?;

    Ok(GrepSearchResult {
        matches: result
            .matches
            .into_iter()
            .map(|m| GrepMatch {
                path: m.path,
                line: m.line as u32,
                content: m.content,
                column: m.column.map(|c| c as u32),
            })
            .collect(),
        files_searched: result.files_searched as u32,
        duration_ms: result.duration_ms,
    })
}

/// Perform grep search with multiple patterns
#[napi]
pub fn grep_search_multi(
    patterns: Vec<String>,
    options: GrepSearchOptions,
) -> Result<Vec<GrepSearchResult>> {
    let opts: grep_engine::GrepOptions = options.into();

    let results = grep_engine::grep_search_multi(patterns, opts)
        .map_err(|e| Error::from_reason(format!("Multi grep search failed: {}", e)))?;

    Ok(results
        .into_iter()
        .map(|r| GrepSearchResult {
            matches: r
                .matches
                .into_iter()
                .map(|m| GrepMatch {
                    path: m.path,
                    line: m.line as u32,
                    content: m.content,
                    column: m.column.map(|c| c as u32),
                })
                .collect(),
            files_searched: r.files_searched as u32,
            duration_ms: r.duration_ms,
        })
        .collect())
}

// =============================================================================
// Glob Match Bindings
// =============================================================================

/// A glob match result
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobMatchResult {
    pub path: String,
    pub is_file: bool,
    pub is_dir: bool,
}

/// Options for glob matching
#[napi(object)]
#[derive(Debug, Clone)]
pub struct GlobMatchOptions {
    pub path: String,
    pub pattern: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub follow_symlinks: Option<bool>,
    pub hidden: Option<bool>,
    pub ignore_patterns: Option<Vec<String>>,
    pub match_dirs: Option<bool>,
}

impl From<GlobMatchOptions> for glob_engine::GlobOptions {
    fn from(opts: GlobMatchOptions) -> Self {
        Self {
            path: std::path::PathBuf::from(opts.path),
            pattern: opts.pattern,
            limit: opts.limit.map(|l| l as usize).unwrap_or(500),
            offset: opts.offset.map(|o| o as usize).unwrap_or(0),
            follow_symlinks: opts.follow_symlinks.unwrap_or(false),
            hidden: opts.hidden.unwrap_or(false),
            ignore_patterns: opts.ignore_patterns.unwrap_or_default(),
            match_dirs: opts.match_dirs.unwrap_or(false),
        }
    }
}

/// Perform glob matching
#[napi]
pub fn glob_match(options: GlobMatchOptions) -> Result<Vec<GlobMatchResult>> {
    let opts: glob_engine::GlobOptions = options.into();

    let results = glob_engine::glob_match(opts)
        .map_err(|e| Error::from_reason(format!("Glob match failed: {}", e)))?;

    Ok(results
        .into_iter()
        .map(|r| GlobMatchResult {
            path: r.path,
            is_file: r.is_file,
            is_dir: r.is_dir,
        })
        .collect())
}

/// Perform glob matching with multiple patterns
#[napi]
pub fn glob_match_multi(
    patterns: Vec<String>,
    options: GlobMatchOptions,
) -> Result<Vec<Vec<GlobMatchResult>>> {
    let opts: glob_engine::GlobOptions = options.into();

    let results = glob_engine::glob_match_multi(patterns, opts)
        .map_err(|e| Error::from_reason(format!("Multi glob match failed: {}", e)))?;

    Ok(results
        .into_iter()
        .map(|v| {
            v.into_iter()
                .map(|r| GlobMatchResult {
                    path: r.path,
                    is_file: r.is_file,
                    is_dir: r.is_dir,
                })
                .collect()
        })
        .collect())
}

/// Glob match with include/exclude patterns
#[napi]
pub fn glob_match_with_negation(
    include: Vec<String>,
    exclude: Vec<String>,
    options: GlobMatchOptions,
) -> Result<Vec<GlobMatchResult>> {
    let opts: glob_engine::GlobOptions = options.into();

    let results = glob_engine::glob_match_with_negation(include, exclude, opts)
        .map_err(|e| Error::from_reason(format!("Glob match with negation failed: {}", e)))?;

    Ok(results
        .into_iter()
        .map(|r| GlobMatchResult {
            path: r.path,
            is_file: r.is_file,
            is_dir: r.is_dir,
        })
        .collect())
}

/// Check if a path matches any of the given patterns
#[napi]
pub fn path_matches_glob(path: String, patterns: Vec<String>) -> Result<bool> {
    glob_engine::path_matches_any(std::path::Path::new(&path), &patterns)
        .map_err(|e| Error::from_reason(format!("Path match check failed: {}", e)))
}

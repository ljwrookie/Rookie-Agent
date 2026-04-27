use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

use lru::LruCache;
use tree_sitter::{Parser, Tree};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    path: PathBuf,
    content_hash: u64,
}

pub struct AstEngine {
    parsers: HashMap<String, Parser>,
    cache: LruCache<CacheKey, Tree>,
}

impl AstEngine {
    pub fn new() -> anyhow::Result<Self> {
        let mut parsers = HashMap::new();

        // Register TypeScript parser
        let mut parser = Parser::new();
        let _ = parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into());
        parsers.insert("typescript".to_string(), parser);

        // Register JavaScript parser (using TypeScript parser for JS as well)
        let mut parser = Parser::new();
        let _ = parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into());
        parsers.insert("javascript".to_string(), parser);

        // Register Python parser
        let mut parser = Parser::new();
        let _ = parser.set_language(&tree_sitter_python::LANGUAGE.into());
        parsers.insert("python".to_string(), parser);

        // Register Go parser
        let mut parser = Parser::new();
        let _ = parser.set_language(&tree_sitter_go::LANGUAGE.into());
        parsers.insert("go".to_string(), parser);

        // Register Rust parser
        let mut parser = Parser::new();
        let _ = parser.set_language(&tree_sitter_rust::LANGUAGE.into());
        parsers.insert("rust".to_string(), parser);

        Ok(Self {
            parsers,
            cache: LruCache::new(NonZeroUsize::new(128).unwrap()),
        })
    }

    pub fn parse(&mut self, path: &Path, content: &str) -> anyhow::Result<Option<Tree>> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let lang = match ext {
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "go" => "go",
            "rs" => "rust",
            _ => "",
        };

        if lang.is_empty() {
            return Ok(None);
        }

        let content_hash = xxhash_rust::xxh3::xxh3_64(content.as_bytes());
        let cache_key = CacheKey {
            path: path.to_path_buf(),
            content_hash,
        };

        // Check cache first
        if let Some(tree) = self.cache.get(&cache_key) {
            return Ok(Some(tree.clone()));
        }

        let parser = self.parsers.get_mut(lang).ok_or_else(|| {
            anyhow::anyhow!("No parser available for language: {}", lang)
        })?;

        let tree = parser
            .parse(content, None)
            .ok_or_else(|| anyhow::anyhow!("Failed to parse file: {}", path.display()))?;

        self.cache.put(cache_key, tree.clone());

        Ok(Some(tree))
    }

    pub fn get_cache(&self) -> &LruCache<CacheKey, Tree> {
        &self.cache
    }

    pub fn get_cache_mut(&mut self) -> &mut LruCache<CacheKey, Tree> {
        &mut self.cache
    }
}

impl Default for AstEngine {
    fn default() -> Self {
        Self::new().expect("Failed to initialize AstEngine")
    }
}

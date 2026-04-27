use std::path::PathBuf;

use super::FileInfo;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tantivy::{
    collector::TopDocs,
    directory::MmapDirectory,
    query::QueryParser,
    schema::{Field, Schema, STORED, TEXT},
    Document, Index, IndexReader, IndexWriter, TantivyDocument,
};
use tantivy::schema::Value;


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub score: f32,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub content: Option<String>,
}

pub struct FileIndex {
    root: PathBuf,
    files: DashMap<PathBuf, FileInfo>,
    index: Option<Index>,
    reader: Option<IndexReader>,
    path_field: Option<Field>,
    content_field: Option<Field>,
}

impl FileIndex {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            files: DashMap::new(),
            index: None,
            reader: None,
            path_field: None,
            content_field: None,
        }
    }

    pub fn build(&mut self) -> anyhow::Result<usize> {
        let mut schema_builder = Schema::builder();
        let path_field = schema_builder.add_text_field("path", TEXT | STORED);
        let content_field = schema_builder.add_text_field("content", TEXT | STORED);
        let schema = schema_builder.build();

        let index_path = self.root.join(".rookie").join("index");
        std::fs::create_dir_all(&index_path)?;

        let index = Index::open_or_create(MmapDirectory::open(&index_path)?, schema)?;
        let mut writer: IndexWriter = index.writer(50_000_000)?;

        let mut count = 0;

        for entry in super::walker::walk_project(&self.root) {
            if entry.is_dir {
                continue;
            }

            let path_str = entry.path.to_string_lossy().to_string();

            let content = if entry.size < 1024 * 1024 {
                // Only index files < 1MB
                std::fs::read_to_string(&entry.path).unwrap_or_default()
            } else {
                String::new()
            };

            let mut doc = TantivyDocument::default();
            doc.add_text(path_field, &path_str);
            doc.add_text(content_field, &content);
            writer.add_document(doc)?;

            self.files.insert(
                entry.path.clone(),
                FileInfo {
                    path: entry.path.clone(),
                    size: entry.size,
                    is_dir: false,
                },
            );

            count += 1;
        }

        writer.commit()?;

        let reader = index.reader()?;

        self.index = Some(index);
        self.reader = Some(reader);
        self.path_field = Some(path_field);
        self.content_field = Some(content_field);

        Ok(count)
    }

    pub fn search(&self, query: &str, limit: usize) -> anyhow::Result<Vec<SearchResult>> {
        let reader = self
            .reader
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Index not built"))?;
        let index = self
            .index
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Index not built"))?;
        let path_field = self
            .path_field
            .ok_or_else(|| anyhow::anyhow!("Index not built"))?;
        let content_field = self
            .content_field
            .ok_or_else(|| anyhow::anyhow!("Index not built"))?;

        let searcher = reader.searcher();
        let query_parser = QueryParser::for_index(index, vec![path_field, content_field]);
        let query = query_parser.parse_query(query)?;

        let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let doc: TantivyDocument = searcher.doc(doc_address)?;
            let path = doc
                .get_first(path_field)
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string();
            let snippet = doc
                .get_first(content_field)
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .chars()
                .take(200)
                .collect::<String>();

            results.push(SearchResult {
                path,
                score,
                snippet,
            });
        }

        Ok(results)
    }

    pub fn update(&self, _changes: &[FileChange]) -> anyhow::Result<()> {
        // TODO: Implement incremental updates
        Ok(())
    }
}

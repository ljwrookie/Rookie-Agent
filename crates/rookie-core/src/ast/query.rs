use serde::{Deserialize, Serialize};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Query, QueryCursor, Tree};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AstMatch {
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub text: String,
    pub kind: String,
}

pub struct QueryPattern {
    pub pattern: String,
}

impl QueryPattern {
    pub fn new(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
        }
    }
}

pub fn search_tree(tree: &Tree, pattern: &QueryPattern, content: &str) -> anyhow::Result<Vec<AstMatch>> {
    let root = tree.root_node();
    let language = root.language();

    let query = Query::new(&language, &pattern.pattern)
        .map_err(|e| anyhow::anyhow!("Query error: {:?}", e))?;

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, root, content.as_bytes());

    let mut results = Vec::new();

    while let Some(m) = matches.next() {
        for capture in m.captures {
            let node = capture.node;
            let start = node.start_position();
            let end = node.end_position();

            let text = node.utf8_text(content.as_bytes())
                .unwrap_or("")
                .to_string();

            results.push(AstMatch {
                start_line: start.row,
                start_column: start.column,
                end_line: end.row,
                end_column: end.column,
                text,
                kind: node.kind().to_string(),
            });
        }
    }

    Ok(results)
}

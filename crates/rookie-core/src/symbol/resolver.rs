use std::path::Path;

use serde::{Deserialize, Serialize};
use tree_sitter::Tree;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolLocation {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolOutline {
    pub name: String,
    pub kind: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub children: Vec<SymbolOutline>,
}

pub struct SymbolEngine;

impl SymbolEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn resolve(
        &self,
        _path: &Path,
        _line: usize,
        _column: usize,
    ) -> Option<SymbolLocation> {
        // TODO: Implement symbol resolution using AST
        None
    }

    pub fn references(
        &self,
        _path: &Path,
        _line: usize,
        _column: usize,
    ) -> Vec<SymbolLocation> {
        // TODO: Implement reference finding
        Vec::new()
    }

    pub fn outline(&self, path: &Path, tree: &Tree, source: &str) -> Vec<SymbolOutline> {
        let root = tree.root_node();
        let mut outlines = Vec::new();
        let path_str = path.to_string_lossy().to_string();
        let source_bytes = source.as_bytes();

        let mut cursor = root.walk();
        for child in root.children(&mut cursor) {
            if let Some(outline) = Self::node_to_outline(child, &path_str, source_bytes) {
                outlines.push(outline);
            }
        }

        outlines
    }

    fn node_to_outline(node: tree_sitter::Node, _path: &str, source_bytes: &[u8]) -> Option<SymbolOutline> {
        let kind = node.kind();
        let start = node.start_position();
        let end = node.end_position();

        let (name, symbol_kind) = match kind {
            "function_declaration" | "method_definition" | "function_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name_text = name_node.utf8_text(source_bytes).ok()?;
                (name_text.to_string(), "function")
            }
            "class_declaration" | "class_definition" | "struct_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name_text = name_node.utf8_text(source_bytes).ok()?;
                (name_text.to_string(), "class")
            }
            "interface_declaration" | "trait_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name_text = name_node.utf8_text(source_bytes).ok()?;
                (name_text.to_string(), "interface")
            }
            _ => return None,
        };

        let mut children = Vec::new();
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if let Some(child_outline) = Self::node_to_outline(child, _path, source_bytes) {
                children.push(child_outline);
            }
        }

        Some(SymbolOutline {
            name,
            kind: symbol_kind.to_string(),
            start_line: start.row,
            start_column: start.column,
            end_line: end.row,
            end_column: end.column,
            children,
        })
    }
}

impl Default for SymbolEngine {
    fn default() -> Self {
        Self::new()
    }
}

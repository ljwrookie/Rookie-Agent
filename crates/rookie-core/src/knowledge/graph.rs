use std::path::{Path, PathBuf};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    pub path: Option<String>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NodeKind {
    Function,
    Class,
    Module,
    Variable,
    Type,
    Interface,
    Trait,
    Package,
    File,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Relation {
    Calls,
    Contains,
    Imports,
    Implements,
    Extends,
    References,
    DependsOn,
    Exports,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    pub path: String,
    pub imports: Vec<String>,
    pub exports: Vec<String>,
    pub dependencies: Vec<String>,
}

pub struct KnowledgeGraph {
    nodes: DashMap<String, KnowledgeNode>,
    edges: DashMap<String, Vec<(String, Relation)>>,
    modules: DashMap<String, ModuleInfo>,
}

impl KnowledgeGraph {
    pub fn new() -> Self {
        Self {
            nodes: DashMap::new(),
            edges: DashMap::new(),
            modules: DashMap::new(),
        }
    }

    pub fn add_node(&self, node: KnowledgeNode) {
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn add_edge(&self, from: &str, to: &str, relation: Relation) {
        self.edges
            .entry(from.to_string())
            .or_default()
            .push((to.to_string(), relation));
    }

    pub fn add_module(&self, info: ModuleInfo) {
        self.modules.insert(info.path.clone(), info);
    }

    pub fn query(&self, query: &str, depth: usize) -> Vec<KnowledgeNode> {
        let mut results = Vec::new();
        let mut visited = std::collections::HashSet::new();

        // Simple name-based search for now
        for entry in self.nodes.iter() {
            let node = entry.value();
            if node.name.contains(query) || node.id.contains(query) {
                if visited.insert(node.id.clone()) {
                    results.push(node.clone());
                    if depth > 0 {
                        self.collect_related(&node.id, depth - 1, &mut visited, &mut results);
                    }
                }
            }
        }

        results
    }

    pub fn get_module_dependencies(&self, path: &str) -> Vec<String> {
        let mut deps = Vec::new();
        if let Some(module) = self.modules.get(path) {
            for dep in &module.dependencies {
                deps.push(dep.clone());
            }
        }
        deps
    }

    pub fn get_module_imports(&self, path: &str) -> Vec<String> {
        if let Some(module) = self.modules.get(path) {
            module.imports.clone()
        } else {
            Vec::new()
        }
    }

    pub fn get_module_exports(&self, path: &str) -> Vec<String> {
        if let Some(module) = self.modules.get(path) {
            module.exports.clone()
        } else {
            Vec::new()
        }
    }

    pub fn analyze_project(&self, root: &Path) -> anyhow::Result<ProjectAnalysis> {
        let mut analysis = ProjectAnalysis {
            total_files: 0,
            total_modules: 0,
            total_functions: 0,
            total_classes: 0,
            languages: std::collections::HashMap::new(),
            entry_points: Vec::new(),
        };

        self.walk_project(root, &mut analysis)?;

        Ok(analysis)
    }

    fn walk_project(&self, root: &Path, analysis: &mut ProjectAnalysis) -> anyhow::Result<()> {
        if root.is_file() {
            self.analyze_file(root, analysis)?;
        } else if root.is_dir() {
            for entry in std::fs::read_dir(root)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if !matches!(name, "node_modules" | "target" | ".git" | "dist" | "build" | "__pycache__" | ".venv") {
                        self.walk_project(&path, analysis)?;
                    }
                } else {
                    self.analyze_file(&path, analysis)?;
                }
            }
        }
        Ok(())
    }

    fn analyze_file(&self, path: &Path, analysis: &mut ProjectAnalysis) -> anyhow::Result<()> {
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let lang = match ext {
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "go" => "go",
            "rs" => "rust",
            _ => return Ok(()),
        };

        analysis.total_files += 1;
        *analysis.languages.entry(lang.to_string()).or_insert(0) += 1;

        let path_str = path.to_string_lossy().to_string();

        // Add file node
        self.add_node(KnowledgeNode {
            id: path_str.clone(),
            name: path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            kind: NodeKind::File,
            path: Some(path_str.clone()),
            metadata: serde_json::json!({
                "language": lang,
                "extension": ext,
            }),
        });

        // Detect entry points
        if path_str.ends_with("index.ts") ||
           path_str.ends_with("index.js") ||
           path_str.ends_with("main.rs") ||
           path_str.ends_with("main.go") ||
           path_str.ends_with("__main__.py") {
            analysis.entry_points.push(path_str);
        }

        Ok(())
    }

    /// Build the full knowledge graph from a project root.
    ///
    /// Walks the project, parses each source file with tree-sitter,
    /// extracts top-level symbols (functions, classes, interfaces, traits),
    /// import/export relationships, and builds nodes + edges.
    pub fn build_from_project(&self, root: &Path) -> anyhow::Result<()> {
        use tree_sitter::Parser;

        // Walk all files
        let files = self.collect_source_files(root)?;

        for file_path in &files {
            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let lang_name = match ext {
                "ts" | "tsx" => "typescript",
                "js" | "jsx" => "javascript",
                "py" => "python",
                "go" => "go",
                "rs" => "rust",
                _ => continue,
            };

            // Read file content
            let content = match std::fs::read_to_string(file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Parse with tree-sitter
            let mut parser = Parser::new();
            let ts_language = match lang_name {
                "typescript" | "javascript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                "python" => tree_sitter_python::LANGUAGE.into(),
                "go" => tree_sitter_go::LANGUAGE.into(),
                "rust" => tree_sitter_rust::LANGUAGE.into(),
                _ => continue,
            };
            if parser.set_language(&ts_language).is_err() {
                continue;
            }
            let tree = match parser.parse(&content, None) {
                Some(t) => t,
                None => continue,
            };

            let file_id = file_path.to_string_lossy().to_string();

            // Add file node
            self.add_node(KnowledgeNode {
                id: file_id.clone(),
                name: file_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                kind: NodeKind::File,
                path: Some(file_id.clone()),
                metadata: serde_json::json!({ "language": lang_name }),
            });

            // Extract symbols from the root node's children
            let root_node = tree.root_node();
            let mut cursor = root_node.walk();
            let mut imports = Vec::new();
            let mut exports = Vec::new();

            for child in root_node.children(&mut cursor) {
                let kind = child.kind();
                let source = &content[child.byte_range()];

                match lang_name {
                    "typescript" | "javascript" => {
                        self.extract_ts_symbols(kind, source, &content, &child, &file_id, &mut imports, &mut exports);
                    }
                    "python" => {
                        self.extract_py_symbols(kind, source, &content, &child, &file_id, &mut imports);
                    }
                    "rust" => {
                        self.extract_rs_symbols(kind, source, &content, &child, &file_id);
                    }
                    "go" => {
                        self.extract_go_symbols(kind, source, &content, &child, &file_id, &mut imports);
                    }
                    _ => {}
                }
            }

            // Add module info
            self.add_module(ModuleInfo {
                path: file_id,
                imports,
                exports,
                dependencies: Vec::new(),
            });
        }

        // Build cross-file dependency edges from import statements
        self.resolve_import_edges();

        Ok(())
    }

    // ── Symbol extraction per language ──────────────────

    fn extract_ts_symbols(
        &self,
        kind: &str,
        _source: &str,
        content: &str,
        node: &tree_sitter::Node,
        file_id: &str,
        imports: &mut Vec<String>,
        exports: &mut Vec<String>,
    ) {
        match kind {
            "function_declaration" | "export_statement" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Function,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);

                    if kind == "export_statement" {
                        exports.push(name.to_string());
                        self.add_edge(file_id, &sym_id, Relation::Exports);
                    }
                }
                // For export_statement, also check the declaration inside
                if kind == "export_statement" {
                    if let Some(decl) = node.child_by_field_name("declaration") {
                        let decl_kind = decl.kind();
                        if let Some(name_node) = decl.child_by_field_name("name") {
                            let name = &content[name_node.byte_range()];
                            let sym_id = format!("{}::{}", file_id, name);
                            let node_kind = match decl_kind {
                                "function_declaration" => NodeKind::Function,
                                "class_declaration" => NodeKind::Class,
                                "interface_declaration" => NodeKind::Interface,
                                "type_alias_declaration" => NodeKind::Type,
                                _ => NodeKind::Variable,
                            };
                            self.add_node(KnowledgeNode {
                                id: sym_id.clone(),
                                name: name.to_string(),
                                kind: node_kind,
                                path: Some(file_id.to_string()),
                                metadata: serde_json::json!({
                                    "line": decl.start_position().row + 1,
                                    "exported": true,
                                }),
                            });
                            self.add_edge(file_id, &sym_id, Relation::Contains);
                            self.add_edge(file_id, &sym_id, Relation::Exports);
                            exports.push(name.to_string());
                        }
                    }
                }
            }
            "class_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Class,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "interface_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Interface,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "type_alias_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Type,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "import_statement" => {
                // Extract the import source
                if let Some(source_node) = node.child_by_field_name("source") {
                    let source = &content[source_node.byte_range()];
                    let cleaned = source.trim_matches(|c| c == '\'' || c == '"');
                    imports.push(cleaned.to_string());
                    self.add_edge(file_id, cleaned, Relation::Imports);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                // Top-level const/let — extract variable names
                if let Some(declarator) = node.named_child(0) {
                    if let Some(name_node) = declarator.child_by_field_name("name") {
                        let name = &content[name_node.byte_range()];
                        let sym_id = format!("{}::{}", file_id, name);
                        self.add_node(KnowledgeNode {
                            id: sym_id.clone(),
                            name: name.to_string(),
                            kind: NodeKind::Variable,
                            path: Some(file_id.to_string()),
                            metadata: serde_json::json!({
                                "line": node.start_position().row + 1,
                            }),
                        });
                        self.add_edge(file_id, &sym_id, Relation::Contains);
                    }
                }
            }
            _ => {}
        }
    }

    fn extract_py_symbols(
        &self,
        kind: &str,
        _source: &str,
        content: &str,
        node: &tree_sitter::Node,
        file_id: &str,
        imports: &mut Vec<String>,
    ) {
        match kind {
            "function_definition" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Function,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "class_definition" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Class,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "import_statement" | "import_from_statement" => {
                if let Some(module_node) = node.child_by_field_name("module_name") {
                    let module_name = &content[module_node.byte_range()];
                    imports.push(module_name.to_string());
                    self.add_edge(file_id, module_name, Relation::Imports);
                }
            }
            _ => {}
        }
    }

    fn extract_rs_symbols(
        &self,
        kind: &str,
        _source: &str,
        content: &str,
        node: &tree_sitter::Node,
        file_id: &str,
    ) {
        match kind {
            "function_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Function,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "struct_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Class,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                            "kind": "struct",
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "enum_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Type,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                            "kind": "enum",
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "trait_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Trait,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "impl_item" => {
                if let Some(type_node) = node.child_by_field_name("type") {
                    let type_name = &content[type_node.byte_range()];
                    // Check for trait impl
                    if let Some(trait_node) = node.child_by_field_name("trait") {
                        let trait_name = &content[trait_node.byte_range()];
                        let type_id = format!("{}::{}", file_id, type_name);
                        self.add_edge(&type_id, trait_name, Relation::Implements);
                    }
                }
            }
            "use_declaration" => {
                // Extract the use path
                let use_text = &content[node.byte_range()];
                if let Some(path_str) = use_text.strip_prefix("use ").and_then(|s| s.strip_suffix(';')) {
                    let base = path_str.split("::").next().unwrap_or(path_str);
                    self.add_edge(file_id, base, Relation::Imports);
                }
            }
            "mod_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Module,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            _ => {}
        }
    }

    fn extract_go_symbols(
        &self,
        kind: &str,
        _source: &str,
        content: &str,
        node: &tree_sitter::Node,
        file_id: &str,
        imports: &mut Vec<String>,
    ) {
        match kind {
            "function_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Function,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                            "exported": name.starts_with(|c: char| c.is_uppercase()),
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "method_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &content[name_node.byte_range()];
                    let sym_id = format!("{}::{}", file_id, name);
                    self.add_node(KnowledgeNode {
                        id: sym_id.clone(),
                        name: name.to_string(),
                        kind: NodeKind::Function,
                        path: Some(file_id.to_string()),
                        metadata: serde_json::json!({
                            "line": node.start_position().row + 1,
                            "is_method": true,
                        }),
                    });
                    self.add_edge(file_id, &sym_id, Relation::Contains);
                }
            }
            "type_declaration" => {
                // Walk children for type_spec
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "type_spec" {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            let name = &content[name_node.byte_range()];
                            let sym_id = format!("{}::{}", file_id, name);
                            let node_kind = if child.child_by_field_name("type")
                                .map(|t| t.kind() == "struct_type" || t.kind() == "interface_type")
                                .unwrap_or(false)
                            {
                                NodeKind::Class
                            } else {
                                NodeKind::Type
                            };
                            self.add_node(KnowledgeNode {
                                id: sym_id.clone(),
                                name: name.to_string(),
                                kind: node_kind,
                                path: Some(file_id.to_string()),
                                metadata: serde_json::json!({
                                    "line": child.start_position().row + 1,
                                }),
                            });
                            self.add_edge(file_id, &sym_id, Relation::Contains);
                        }
                    }
                }
            }
            "import_declaration" => {
                // Walk import specs
                let import_text = &content[node.byte_range()];
                for line in import_text.lines() {
                    let trimmed = line.trim().trim_matches('"');
                    if trimmed.contains('/') && !trimmed.starts_with("import") && !trimmed.starts_with('(') && !trimmed.starts_with(')') {
                        let pkg = trimmed.split_whitespace().last().unwrap_or(trimmed).trim_matches('"');
                        if !pkg.is_empty() && pkg.contains('/') {
                            imports.push(pkg.to_string());
                            self.add_edge(file_id, pkg, Relation::Imports);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // ── Helpers ──────────────────────────────────────────

    fn collect_source_files(&self, root: &Path) -> anyhow::Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        self.collect_files_recursive(root, &mut files)?;
        Ok(files)
    }

    fn collect_files_recursive(&self, dir: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
        if dir.is_file() {
            let ext = dir.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rs") {
                files.push(dir.to_path_buf());
            }
            return Ok(());
        }

        if !dir.is_dir() {
            return Ok(());
        }

        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !matches!(name, "node_modules" | "target" | ".git" | "dist" | "build" | "__pycache__" | ".venv" | "vendor") {
                    self.collect_files_recursive(&path, files)?;
                }
            } else {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rs") {
                    files.push(path);
                }
            }
        }

        Ok(())
    }

    /// Resolve import edges: for each module's imports, try to find
    /// a matching file node and create a DependsOn edge.
    fn resolve_import_edges(&self) {
        let all_file_ids: Vec<String> = self.nodes.iter()
            .filter(|entry| matches!(entry.value().kind, NodeKind::File))
            .map(|entry| entry.key().clone())
            .collect();

        for module_entry in self.modules.iter() {
            let module_path = module_entry.key();
            for import_spec in &module_entry.value().imports {
                // Try to resolve the import to an existing file
                for file_id in &all_file_ids {
                    if file_id.contains(import_spec) || file_id.ends_with(&format!("{}.ts", import_spec)) {
                        self.add_edge(module_path, file_id, Relation::DependsOn);
                        break;
                    }
                }
            }
        }
    }

    fn collect_related(
        &self,
        node_id: &str,
        depth: usize,
        visited: &mut std::collections::HashSet<String>,
        results: &mut Vec<KnowledgeNode>,
    ) {
        if depth == 0 {
            return;
        }

        if let Some(edges) = self.edges.get(node_id) {
            for (target_id, _) in edges.value().iter() {
                if visited.insert(target_id.clone()) {
                    if let Some(node) = self.nodes.get(target_id) {
                        results.push(node.clone());
                        self.collect_related(target_id, depth - 1, visited, results);
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAnalysis {
    pub total_files: usize,
    pub total_modules: usize,
    pub total_functions: usize,
    pub total_classes: usize,
    pub languages: std::collections::HashMap<String, usize>,
    pub entry_points: Vec<String>,
}

impl Default for KnowledgeGraph {
    fn default() -> Self {
        Self::new()
    }
}

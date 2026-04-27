use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::RwLock;

use crate::ast::{engine::AstEngine, query::AstMatch};
use crate::index::tantivy::{FileIndex, SearchResult};
use crate::knowledge::graph::{KnowledgeGraph, KnowledgeNode};
use crate::symbol::resolver::{SymbolEngine, SymbolLocation, SymbolOutline};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResponse {
    pub success: bool,
    pub language: Option<String>,
    pub root_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub path: String,
    pub pattern: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub matches: Vec<AstMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildIndexRequest {
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildIndexResponse {
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexSearchRequest {
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexSearchResponse {
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolResolveRequest {
    pub path: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolResolveResponse {
    pub location: Option<SymbolLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolOutlineRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolOutlineResponse {
    pub outlines: Vec<SymbolOutline>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeQueryRequest {
    pub query: String,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeQueryResponse {
    pub nodes: Vec<KnowledgeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeAnalyzeRequest {
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeAnalyzeResponse {
    pub total_files: usize,
    pub languages: std::collections::HashMap<String, usize>,
    pub entry_points: Vec<String>,
}

pub struct RookieServer {
    ast: Arc<RwLock<AstEngine>>,
    index: Arc<RwLock<FileIndex>>,
    knowledge: Arc<KnowledgeGraph>,
    symbol: Arc<SymbolEngine>,
}

impl RookieServer {
    pub fn new() -> Self {
        Self {
            ast: Arc::new(RwLock::new(AstEngine::new().expect("Failed to create AstEngine"))),
            index: Arc::new(RwLock::new(FileIndex::new(PathBuf::from(".")))),
            knowledge: Arc::new(KnowledgeGraph::new()),
            symbol: Arc::new(SymbolEngine::new()),
        }
    }

    pub async fn serve_stdio(self) -> anyhow::Result<()> {
        // Bootstrap structured logging and obtain the event receiver so we can
        // forward each record as a JSON-RPC `log.event` notification to the TS
        // orchestration layer (see `docs/superpowers/specs/...` P0-T2).
        let mut log_rx = crate::logger::init();
        // `log_rx` is a broadcast receiver; we only keep the forwarder
        // consumer, so lagging records just get dropped without panicking.

        let stdin = tokio::io::stdin();
        let stdout = tokio::io::stdout();
        let stdout = Arc::new(tokio::sync::Mutex::new(stdout));
        let reader = BufReader::new(stdin);
        let mut lines = reader.lines();

        // Spawn a dedicated forwarder so log events never block request handling.
        let log_stdout = stdout.clone();
        tokio::spawn(async move {
            loop {
                match log_rx.recv().await {
                    Ok(event) => {
                        let notification = serde_json::json!({
                            "jsonrpc": "2.0",
                            "method": "log.event",
                            "params": event,
                        });
                        let mut out = log_stdout.lock().await;
                        if out.write_all(notification.to_string().as_bytes()).await.is_err() {
                            break;
                        }
                        let _ = out.write_all(b"\n").await;
                        let _ = out.flush().await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        tracing::info!(agent = "rookie-core", "server.start");

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            let response = match self.handle_request_line(&line).await {
                Ok(result) => {
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": result.get("id").unwrap_or(&serde_json::json!(null)),
                        "result": result.get("result").unwrap_or(&serde_json::json!({}))
                    })
                }
                Err((id, message)) => {
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32000, "message": message }
                    })
                }
            };

            let mut out = stdout.lock().await;
            out.write_all(response.to_string().as_bytes()).await?;
            out.write_all(b"\n").await?;
            out.flush().await?;
        }

        Ok(())
    }

    async fn handle_request_line(&self, line: &str) -> Result<serde_json::Value, (serde_json::Value, String)> {
        let request: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| (serde_json::json!(null), format!("Invalid JSON: {}", e)))?;

        let id = request.get("id").cloned().unwrap_or(serde_json::json!(null));
        let method_str = request.get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| (id.clone(), "Missing method".to_string()))?
            .to_string();
        let method = method_str.as_str();
        let params = request.get("params").cloned().unwrap_or(serde_json::json!({}));

        let started = std::time::Instant::now();
        tracing::info!(method = %method, "rpc.dispatch");

        let result = match method {
            "ast.parse" => {
                let req: ParseRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let mut ast = self.ast.write().await;
                let path = PathBuf::from(&req.path);
                match ast.parse(&path, &req.content) {
                    Ok(Some(tree)) => {
                        let root = tree.root_node();
                        serde_json::to_value(ParseResponse {
                            success: true,
                            language: Some("detected".to_string()),
                            root_kind: Some(root.kind().to_string()),
                        }).unwrap()
                    }
                    Ok(None) => serde_json::to_value(ParseResponse {
                        success: false,
                        language: None,
                        root_kind: None,
                    }).unwrap(),
                    Err(e) => return Err((id, format!("Parse error: {}", e))),
                }
            }
            "ast.search" => {
                let req: SearchRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let mut ast = self.ast.write().await;
                let path = PathBuf::from(&req.path);
                match ast.parse(&path, &req.content) {
                    Ok(Some(tree)) => {
                        let pattern = crate::ast::query::QueryPattern::new(&req.pattern);
                        match crate::ast::query::search_tree(&tree, &pattern, &req.content) {
                            Ok(matches) => serde_json::to_value(SearchResponse { matches }).unwrap(),
                            Err(e) => return Err((id, format!("Search error: {}", e))),
                        }
                    }
                    _ => serde_json::to_value(SearchResponse { matches: vec![] }).unwrap(),
                }
            }
            "index.build" => {
                let req: BuildIndexRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let mut index = self.index.write().await;
                let root = PathBuf::from(&req.root);
                *index = FileIndex::new(root);
                match index.build() {
                    Ok(count) => serde_json::to_value(BuildIndexResponse { file_count: count }).unwrap(),
                    Err(e) => return Err((id, format!("Index build error: {}", e))),
                }
            }
            "index.search" => {
                let req: IndexSearchRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let index = self.index.read().await;
                match index.search(&req.query, req.limit) {
                    Ok(results) => serde_json::to_value(IndexSearchResponse { results }).unwrap(),
                    Err(e) => return Err((id, format!("Search error: {}", e))),
                }
            }
            "symbol.resolve" => {
                let req: SymbolResolveRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let path = PathBuf::from(&req.path);
                let location = self.symbol.resolve(&path, req.line, req.column);
                serde_json::to_value(SymbolResolveResponse { location }).unwrap()
            }
            "symbol.outline" => {
                let req: SymbolOutlineRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let mut ast = self.ast.write().await;
                let path = PathBuf::from(&req.path);
                match ast.parse(&path, &req.content) {
                    Ok(Some(tree)) => {
                        let outlines = self.symbol.outline(&path, &tree, &req.content);
                        serde_json::to_value(SymbolOutlineResponse { outlines }).unwrap()
                    }
                    _ => serde_json::to_value(SymbolOutlineResponse { outlines: vec![] }).unwrap(),
                }
            }
            "knowledge.query" => {
                let req: KnowledgeQueryRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let nodes = self.knowledge.query(&req.query, req.depth);
                serde_json::to_value(KnowledgeQueryResponse { nodes }).unwrap()
            }
            "knowledge.analyze" => {
                let req: KnowledgeAnalyzeRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let root = PathBuf::from(&req.root);
                match self.knowledge.analyze_project(&root) {
                    Ok(analysis) => serde_json::to_value(KnowledgeAnalyzeResponse {
                        total_files: analysis.total_files,
                        languages: analysis.languages,
                        entry_points: analysis.entry_points,
                    }).unwrap(),
                    Err(e) => return Err((id, format!("Analyze error: {}", e))),
                }
            }
            "knowledge.build" => {
                let req: KnowledgeAnalyzeRequest = serde_json::from_value(params)
                    .map_err(|e| (id.clone(), format!("Invalid params: {}", e)))?;
                let root = PathBuf::from(&req.root);
                match self.knowledge.build_from_project(&root) {
                    Ok(()) => serde_json::json!({ "status": "ok" }),
                    Err(e) => return Err((id, format!("Build error: {}", e))),
                }
            }
            _ => return Err((id, format!("Unknown method: {}", method))),
        };

        let duration_ms = started.elapsed().as_millis() as u64;
        tracing::info!(method = %method, duration_ms = duration_ms, "rpc.complete");

        Ok(serde_json::json!({ "id": id, "result": result }))
    }
}

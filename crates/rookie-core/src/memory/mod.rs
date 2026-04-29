//! Memory system for Rookie Agent
//!
//! Provides persistent storage and retrieval for:
//! - Session messages (SQLite + FTS5)
//! - Curated memories (agent-learned facts)
//! - Vector embeddings (HNSW semantic search)
//! - Hybrid search (combining FTS + vector with RRF)

pub mod store;
pub mod vector;

pub use store::{CuratedMemory, MemoryEntry, MemoryStore, Message, Session, HybridSearchResult};
pub use vector::{SearchResult, SharedVectorIndex, VectorEntry, VectorIndex, create_index};

#[cfg(feature = "napi")]
use napi::bindgen_prelude::*;
#[cfg(feature = "napi")]
use napi_derive::napi;
use std::sync::Arc;

/// NAPI-exposed memory store
#[cfg(feature = "napi")]
#[napi]
pub struct NapiMemoryStore {
    inner: Arc<MemoryStore>,
}

#[cfg(feature = "napi")]
#[napi]
impl NapiMemoryStore {
    /// Create a new memory store at the given path
    #[napi(constructor)]
    pub fn new(db_path: String) -> Result<Self> {
        let store = MemoryStore::new(&db_path)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to open database: {}", e)))?;

        Ok(Self {
            inner: Arc::new(store),
        })
    }

    /// Create an in-memory store (for testing)
    #[napi(factory)]
    pub fn new_in_memory() -> Result<Self> {
        let store = MemoryStore::new_in_memory()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create database: {}", e)))?;

        Ok(Self {
            inner: Arc::new(store),
        })
    }

    /// Create a new session
    #[napi]
    pub fn create_session(&self, title: Option<String>) -> Result<String> {
        let session = self
            .inner
            .create_session(title.as_deref())
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(session.id)
    }

    /// Get session by ID
    #[napi]
    pub fn get_session(&self, session_id: String) -> Result<Option<String>> {
        let session = self
            .inner
            .get_session(&session_id)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(session.map(|s| serde_json::to_string(&s).unwrap_or_default()))
    }

    /// List sessions
    #[napi]
    pub fn list_sessions(&self, limit: u32, offset: u32) -> Result<Vec<String>> {
        let sessions = self
            .inner
            .list_sessions(limit as usize, offset as usize)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(sessions
            .into_iter()
            .map(|s| serde_json::to_string(&s).unwrap_or_default())
            .collect())
    }

    /// Delete session
    #[napi]
    pub fn delete_session(&self, session_id: String) -> Result<bool> {
        self.inner
            .delete_session(&session_id)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Add message to session
    #[napi]
    pub fn add_message(
        &self,
        session_id: String,
        role: String,
        content: String,
        tool_calls: Option<String>,
        tool_call_id: Option<String>,
    ) -> Result<String> {
        let tool_calls_json = tool_calls
            .and_then(|s| serde_json::from_str(&s).ok());

        let message = self
            .inner
            .add_message(&session_id, &role, &content, tool_calls_json, tool_call_id.as_deref())
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(serde_json::to_string(&message).unwrap_or_default())
    }

    /// Get messages for session
    #[napi]
    pub fn get_messages(&self, session_id: String, limit: u32) -> Result<Vec<String>> {
        let messages = self
            .inner
            .get_messages_chronological(&session_id, limit as usize)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(messages
            .into_iter()
            .map(|m| serde_json::to_string(&m).unwrap_or_default())
            .collect())
    }

    /// Search messages using FTS5
    #[napi]
    pub fn search(&self, query: String, limit: u32) -> Result<Vec<String>> {
        let results = self
            .inner
            .search(&query, limit as usize)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(results
            .into_iter()
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .collect())
    }

    /// Save curated memory
    #[napi]
    pub fn save_curated(
        &self,
        id: String,
        memory_type: String,
        content: String,
        confidence: f64,
        source: String,
    ) -> Result<()> {
        let memory = CuratedMemory {
            id,
            memory_type,
            content,
            confidence,
            source,
            created_at: store::MemoryStore::now(),
            last_used_at: store::MemoryStore::now(),
            use_count: 0,
            embedding: None,
        };

        self.inner
            .save_curated(&memory)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Search curated memories
    #[napi]
    pub fn search_curated(&self, query: String, limit: u32) -> Result<Vec<String>> {
        let results = self
            .inner
            .search_curated(&query, limit as usize)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(results
            .into_iter()
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .collect())
    }

    /// Get curated memories by type
    #[napi]
    pub fn get_curated_by_type(&self, memory_type: String, limit: u32) -> Result<Vec<String>> {
        let results = self
            .inner
            .get_curated_by_type(&memory_type, limit as usize)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(results
            .into_iter()
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .collect())
    }

    /// Delete curated memory
    #[napi]
    pub fn delete_curated(&self, id: String) -> Result<bool> {
        self.inner
            .delete_curated(&id)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Get database stats
    #[napi]
    pub fn get_stats(&self) -> Result<String> {
        let stats = self
            .inner
            .get_stats()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(serde_json::to_string(&stats).unwrap_or_default())
    }
}

/// NAPI-exposed vector index
#[cfg(feature = "napi")]
#[napi]
pub struct NapiVectorIndex {
    inner: Arc<VectorIndex>,
}

#[cfg(feature = "napi")]
#[napi]
impl NapiVectorIndex {
    /// Create a new vector index with specified dimension
    #[napi(constructor)]
    pub fn new(dimension: u32) -> Self {
        Self {
            inner: Arc::new(VectorIndex::with_defaults(dimension as usize)),
        }
    }

    /// Add a vector
    #[napi]
    pub fn add(&self, id: i64, vector: Vec<f64>) {
        let vector: Vec<f32> = vector.iter().map(|&v| v as f32).collect();
        self.inner.add(id as u64, vector);
    }

    /// Search for nearest neighbors
    #[napi]
    pub fn search(&self, query: Vec<f64>, k: u32) -> Result<Vec<NapiSearchResult>> {
        let query: Vec<f32> = query.iter().map(|&v| v as f32).collect();
        let results = self.inner.search(&query, k as usize);
        Ok(results
            .into_iter()
            .map(|(id, distance)| NapiSearchResult { id: id as i64, distance })
            .collect())
    }

    /// Delete a vector
    #[napi]
    pub fn delete(&self, id: i64) -> bool {
        self.inner.delete(id as u64)
    }

    /// Get vector count
    #[napi(getter)]
    pub fn len(&self) -> u32 {
        self.inner.len() as u32
    }

    /// Check if empty
    #[napi(getter)]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Clear all vectors
    #[napi]
    pub fn clear(&self) {
        self.inner.clear();
    }
}

/// Search result for NAPI
#[cfg(feature = "napi")]
#[napi(object)]
pub struct NapiSearchResult {
    pub id: i64,
    pub distance: f64,
}

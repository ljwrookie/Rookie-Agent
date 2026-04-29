//! Memory Store with SQLite + FTS5 + Vector Search
//!
//! Provides persistent storage for sessions, messages, and curated memories
//! with hybrid retrieval capabilities (FTS5 + HNSW vector search).

use rusqlite::types::ValueRef;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Memory entry from FTS5 search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub rank: Option<f64>,
}

/// Curated memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuratedMemory {
    pub id: String,
    pub memory_type: String,
    pub content: String,
    pub confidence: f64,
    pub source: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub use_count: i32,
    pub embedding: Option<Vec<f32>>,
}

/// Session metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i32,
    pub metadata: Option<serde_json::Value>,
}

/// Message within a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<serde_json::Value>,
    pub tool_call_id: Option<String>,
    pub created_at: i64,
    pub embedding: Option<Vec<f32>>,
}

/// Hybrid search result combining FTS and vector scores
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchResult {
    pub entry: MemoryEntry,
    pub fts_score: f64,
    pub vector_score: Option<f64>,
    pub combined_score: f64,
}

/// Memory store with SQLite + FTS5 + optional vector index
pub struct MemoryStore {
    conn: Arc<Mutex<Connection>>,
    vector_index: Option<Arc<super::vector::VectorIndex>>,
    db_path: String,
}

impl MemoryStore {
    /// Create or open a memory store at the given path
    pub fn new<P: AsRef<Path>>(db_path: P) -> SqliteResult<Self> {
        let db_path = db_path.as_ref().to_string_lossy().to_string();
        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better concurrent performance
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = 10000;
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 30000000000;",
        )?;

        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
            vector_index: None,
            db_path,
        };

        store.init_schema()?;
        info!("MemoryStore initialized at {}", store.db_path);

        Ok(store)
    }

    /// Create an in-memory store (for testing)
    pub fn new_in_memory() -> SqliteResult<Self> {
        let conn = Connection::open_in_memory()?;

        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
            vector_index: None,
            db_path: ":memory:".to_string(),
        };

        store.init_schema()?;
        Ok(store)
    }

    /// Initialize database schema
    fn init_schema(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Sessions table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                message_count INTEGER NOT NULL DEFAULT 0,
                metadata TEXT
            )",
            [],
        )?;

        // Messages table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT,
                tool_call_id TEXT,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // FTS5 virtual table for messages
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                content_rowid='id',
                tokenize='porter unicode61'
            )",
            [],
        )?;

        // Triggers to keep FTS index in sync
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS messages_fts_insert
             AFTER INSERT ON messages
             BEGIN
                 INSERT INTO messages_fts(rowid, content) VALUES (NEW.id, NEW.content);
             END",
            [],
        )?;

        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS messages_fts_delete
             AFTER DELETE ON messages
             BEGIN
                 INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.id, OLD.content);
             END",
            [],
        )?;

        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS messages_fts_update
             AFTER UPDATE ON messages
             BEGIN
                 INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.id, OLD.content);
                 INSERT INTO messages_fts(rowid, content) VALUES (NEW.id, NEW.content);
             END",
            [],
        )?;

        // Curated memory table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS curated_memory (
                id TEXT PRIMARY KEY,
                memory_type TEXT NOT NULL,
                content TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                source TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
                use_count INTEGER NOT NULL DEFAULT 0,
                embedding BLOB
            )",
            [],
        )?;

        // FTS5 for curated memory
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS curated_fts USING fts5(
                content,
                content_rowid='rowid',
                tokenize='porter unicode61'
            )",
            [],
        )?;

        // Triggers for curated memory FTS
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS curated_fts_insert
             AFTER INSERT ON curated_memory
             BEGIN
                 INSERT INTO curated_fts(rowid, content) VALUES ((SELECT rowid FROM curated_memory WHERE id = NEW.id), NEW.content);
             END",
            [],
        )?;

        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS curated_fts_delete
             AFTER DELETE ON curated_memory
             BEGIN
                 INSERT INTO curated_fts(curated_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
             END",
            [],
        )?;

        // Indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_curated_memory_type ON curated_memory(memory_type)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_curated_last_used ON curated_memory(last_used_at DESC)",
            [],
        )?;

        debug!("MemoryStore schema initialized");
        Ok(())
    }

    /// Attach a vector index for semantic search
    pub fn with_vector_index(mut self, index: Arc<super::vector::VectorIndex>) -> Self {
        self.vector_index = Some(index);
        self
    }

    // ── Session Operations ─────────────────────────────────────────

    /// Create a new session
    pub fn create_session(&self, title: Option<&str>) -> SqliteResult<Session> {
        let id = Uuid::new_v4().to_string();
        let now = Self::now();

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, title, now],
        )?;

        Ok(Session {
            id,
            title: title.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
            message_count: 0,
            metadata: None,
        })
    }

    /// Get session by ID
    pub fn get_session(&self, session_id: &str) -> SqliteResult<Option<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, message_count, metadata FROM sessions WHERE id = ?1"
        )?;

        let session = stmt
            .query_row(params![session_id], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                    metadata: row.get::<_, Option<String>>(5)?.and_then(|s| {
                        serde_json::from_str(&s).ok()
                    }),
                })
            })
            .optional()?;

        Ok(session)
    }

    /// List sessions with pagination
    pub fn list_sessions(&self, limit: usize, offset: usize) -> SqliteResult<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, message_count, metadata 
             FROM sessions ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2"
        )?;

        let sessions = stmt
            .query_map(params![limit as i64, offset as i64], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                    metadata: row.get::<_, Option<String>>(5)?.and_then(|s| {
                        serde_json::from_str(&s).ok()
                    }),
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(sessions)
    }

    /// Update session
    pub fn update_session(&self, session_id: &str, title: Option<&str>) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now();

        let rows = conn.execute(
            "UPDATE sessions SET title = COALESCE(?1, title), updated_at = ?2 WHERE id = ?3",
            params![title, now, session_id],
        )?;

        Ok(rows > 0)
    }

    /// Delete session and all its messages
    pub fn delete_session(&self, session_id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(rows > 0)
    }

    // ── Message Operations ─────────────────────────────────────────

    /// Add a message to a session
    pub fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<serde_json::Value>,
        tool_call_id: Option<&str>,
    ) -> SqliteResult<Message> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now();

        // Insert message
        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, created_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session_id,
                role,
                content,
                tool_calls.as_ref().map(|v| v.to_string()),
                tool_call_id,
                now
            ],
        )?;

        let id = conn.last_insert_rowid();

        // Update session message count and timestamp
        conn.execute(
            "UPDATE sessions SET message_count = message_count + 1, updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;

        Ok(Message {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            tool_calls,
            tool_call_id: tool_call_id.map(|s| s.to_string()),
            created_at: now,
            embedding: None,
        })
    }

    /// Get messages for a session
    pub fn get_messages(&self, session_id: &str, limit: usize) -> SqliteResult<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at 
             FROM messages WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2"
        )?;

        let messages = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get::<_, Option<String>>(4)?.and_then(|s| {
                        serde_json::from_str(&s).ok()
                    }),
                    tool_call_id: row.get(5)?,
                    created_at: row.get(6)?,
                    embedding: None,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(messages)
    }

    /// Get messages for a session in chronological order
    pub fn get_messages_chronological(
        &self,
        session_id: &str,
        limit: usize,
    ) -> SqliteResult<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at 
             FROM messages WHERE session_id = ?1 ORDER BY id ASC LIMIT ?2"
        )?;

        let messages = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get::<_, Option<String>>(4)?.and_then(|s| {
                        serde_json::from_str(&s).ok()
                    }),
                    tool_call_id: row.get(5)?,
                    created_at: row.get(6)?,
                    embedding: None,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(messages)
    }

    // ── FTS5 Search ────────────────────────────────────────────────

    /// Search messages using FTS5
    pub fn search(&self, query: &str, limit: usize) -> SqliteResult<Vec<MemoryEntry>> {
        let conn = self.conn.lock().unwrap();

        // Sanitize query for FTS5
        let sanitized = Self::sanitize_fts_query(query);

        let sql = format!(
            "SELECT m.id, m.session_id, m.role, m.content, m.created_at,
                    rank as fts_rank
             FROM messages_fts f
             JOIN messages m ON m.id = f.rowid
             WHERE messages_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        );

        let mut stmt = conn.prepare(&sql)?;
        let entries = stmt
            .query_map(params![sanitized, limit as i64], |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                    rank: row.get(5).ok(),
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(entries)
    }

    /// Search curated memory using FTS5
    pub fn search_curated(&self, query: &str, limit: usize) -> SqliteResult<Vec<CuratedMemory>> {
        let conn = self.conn.lock().unwrap();
        let sanitized = Self::sanitize_fts_query(query);

        let sql = format!(
            "SELECT cm.id, cm.memory_type, cm.content, cm.confidence, cm.source, 
                    cm.created_at, cm.last_used_at, cm.use_count, cm.embedding
             FROM curated_fts f
             JOIN curated_memory cm ON cm.rowid = f.rowid
             WHERE curated_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        );

        let mut stmt = conn.prepare(&sql)?;
        let memories = stmt
            .query_map(params![sanitized, limit as i64], |row| {
                Ok(CuratedMemory {
                    id: row.get(0)?,
                    memory_type: row.get(1)?,
                    content: row.get(2)?,
                    confidence: row.get(3)?,
                    source: row.get(4)?,
                    created_at: row.get(5)?,
                    last_used_at: row.get(6)?,
                    use_count: row.get(7)?,
                    embedding: Self::deserialize_embedding(row.get_ref(8)?),
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(memories)
    }

    // ── Curated Memory Operations ──────────────────────────────────

    /// Save curated memory
    pub fn save_curated(&self, memory: &CuratedMemory) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        let embedding_blob = memory
            .embedding
            .as_ref()
            .map(|e| Self::serialize_embedding(e));

        conn.execute(
            "INSERT OR REPLACE INTO curated_memory 
             (id, memory_type, content, confidence, source, created_at, last_used_at, use_count, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                memory.id,
                memory.memory_type,
                memory.content,
                memory.confidence,
                memory.source,
                memory.created_at,
                memory.last_used_at,
                memory.use_count,
                embedding_blob
            ],
        )?;

        Ok(())
    }

    /// Get curated memory by ID
    pub fn get_curated(&self, id: &str) -> SqliteResult<Option<CuratedMemory>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, memory_type, content, confidence, source, 
                    created_at, last_used_at, use_count, embedding
             FROM curated_memory WHERE id = ?1"
        )?;

        let memory = stmt
            .query_row(params![id], |row| {
                Ok(CuratedMemory {
                    id: row.get(0)?,
                    memory_type: row.get(1)?,
                    content: row.get(2)?,
                    confidence: row.get(3)?,
                    source: row.get(4)?,
                    created_at: row.get(5)?,
                    last_used_at: row.get(6)?,
                    use_count: row.get(7)?,
                    embedding: Self::deserialize_embedding(row.get_ref(8)?),
                })
            })
            .optional()?;

        Ok(memory)
    }

    /// Get curated memories by type
    pub fn get_curated_by_type(
        &self,
        memory_type: &str,
        limit: usize,
    ) -> SqliteResult<Vec<CuratedMemory>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, memory_type, content, confidence, source, 
                    created_at, last_used_at, use_count, embedding
             FROM curated_memory WHERE memory_type = ?1 
             ORDER BY last_used_at DESC LIMIT ?2"
        )?;

        let memories = stmt
            .query_map(params![memory_type, limit as i64], |row| {
                Ok(CuratedMemory {
                    id: row.get(0)?,
                    memory_type: row.get(1)?,
                    content: row.get(2)?,
                    confidence: row.get(3)?,
                    source: row.get(4)?,
                    created_at: row.get(5)?,
                    last_used_at: row.get(6)?,
                    use_count: row.get(7)?,
                    embedding: Self::deserialize_embedding(row.get_ref(8)?),
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(memories)
    }

    /// Update curated memory usage
    pub fn touch_curated(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now();

        let rows = conn.execute(
            "UPDATE curated_memory SET last_used_at = ?1, use_count = use_count + 1 WHERE id = ?2",
            params![now, id],
        )?;

        Ok(rows > 0)
    }

    /// Delete curated memory
    pub fn delete_curated(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM curated_memory WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // ── Hybrid Search (FTS + Vector) ───────────────────────────────

    /// Perform hybrid search using RRF (Reciprocal Rank Fusion)
    pub fn hybrid_search(
        &self,
        query: &str,
        query_embedding: Option<&[f32]>,
        limit: usize,
    ) -> SqliteResult<Vec<HybridSearchResult>> {
        // Get FTS results
        let fts_results = self.search(query, limit * 2)?;

        // Get vector results if embedding provided
        let vector_results: Vec<(i64, f64)> = if let (Some(emb), Some(vi)) =
            (query_embedding, self.vector_index.as_ref())
        {
            vi.search(emb, limit * 2)
                .into_iter()
                .map(|(id, score)| (id as i64, score))
                .collect()
        } else {
            vec![]
        };

        // RRF fusion
        let k = 60.0;
        let mut scores: HashMap<i64, (MemoryEntry, f64, Option<f64>, f64)> = HashMap::new();

        // Add FTS scores
        for (rank, entry) in fts_results.iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f64 + 1.0);
            scores.insert(
                entry.id,
                (entry.clone(), rrf_score, None, rrf_score),
            );
        }

        // Add vector scores
        for (rank, (id, v_score)) in vector_results.iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f64 + 1.0);
            if let Some((entry, fts_s, _, _)) = scores.get(id) {
                // Combine scores
                let combined = *fts_s + rrf_score;
                scores.insert(*id, (entry.clone(), *fts_s, Some(*v_score), combined));
            } else if let Ok(Some(entry)) = self.get_message_by_id(*id) {
                scores.insert(
                    *id,
                    (
                        MemoryEntry {
                            id: entry.id,
                            session_id: entry.session_id,
                            role: entry.role,
                            content: entry.content,
                            created_at: entry.created_at,
                            rank: None,
                        },
                        0.0,
                        Some(*v_score),
                        rrf_score,
                    ),
                );
            }
        }

        // Sort by combined score and take top results
        let mut results: Vec<HybridSearchResult> = scores
            .into_values()
            .map(|(entry, fts_score, vec_score, combined)| HybridSearchResult {
                entry,
                fts_score,
                vector_score: vec_score,
                combined_score: combined,
            })
            .collect();

        results.sort_by(|a, b| {
            b.combined_score
                .partial_cmp(&a.combined_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(limit);
        Ok(results)
    }

    /// Get message by ID
    fn get_message_by_id(&self, id: i64) -> SqliteResult<Option<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at 
             FROM messages WHERE id = ?1"
        )?;

        let message = stmt
            .query_row(params![id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get::<_, Option<String>>(4)?.and_then(|s| {
                        serde_json::from_str(&s).ok()
                    }),
                    tool_call_id: row.get(5)?,
                    created_at: row.get(6)?,
                    embedding: None,
                })
            })
            .optional()?;

        Ok(message)
    }

    // ── Utility ────────────────────────────────────────────────────

    /// Get database stats
    pub fn get_stats(&self) -> SqliteResult<HashMap<String, i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stats = HashMap::new();

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
        stats.insert("sessions".to_string(), session_count);

        let message_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
        stats.insert("messages".to_string(), message_count);

        let curated_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM curated_memory", [], |row| row.get(0))?;
        stats.insert("curated".to_string(), curated_count);

        Ok(stats)
    }

    /// Close the database connection
    pub fn close(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // Connection will be closed when dropped
        Ok(())
    }

    /// Get current Unix timestamp
    pub fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }

    /// Sanitize FTS5 query to prevent syntax errors
    fn sanitize_fts_query(query: &str) -> String {
        // Escape special FTS5 characters
        query
            .replace('"', "\"\"")
            .replace('*', "")
            .replace('^', "")
    }

    /// Serialize embedding vector to bytes
    fn serialize_embedding(embedding: &[f32]) -> Vec<u8> {
        embedding
            .iter()
            .flat_map(|&f| f.to_le_bytes())
            .collect()
    }

    /// Deserialize embedding from bytes
    fn deserialize_embedding(value_ref: ValueRef) -> Option<Vec<f32>> {
        match value_ref {
            ValueRef::Blob(blob) => {
                let mut result = Vec::with_capacity(blob.len() / 4);
                for chunk in blob.chunks_exact(4) {
                    let bytes: [u8; 4] = chunk.try_into().ok()?;
                    result.push(f32::from_le_bytes(bytes));
                }
                Some(result)
            }
            _ => None,
        }
    }
}

impl Clone for MemoryStore {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
            vector_index: self.vector_index.clone(),
            db_path: self.db_path.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_crud() {
        let store = MemoryStore::new_in_memory().unwrap();

        // Create session
        let session = store.create_session(Some("Test Session")).unwrap();
        assert_eq!(session.title, Some("Test Session".to_string()));

        // Get session
        let retrieved = store.get_session(&session.id).unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().title, Some("Test Session".to_string()));

        // Update session
        store.update_session(&session.id, Some("Updated Title")).unwrap();
        let updated = store.get_session(&session.id).unwrap().unwrap();
        assert_eq!(updated.title, Some("Updated Title".to_string()));

        // List sessions
        let sessions = store.list_sessions(10, 0).unwrap();
        assert_eq!(sessions.len(), 1);

        // Delete session
        store.delete_session(&session.id).unwrap();
        let deleted = store.get_session(&session.id).unwrap();
        assert!(deleted.is_none());
    }

    #[test]
    fn test_message_crud() {
        let store = MemoryStore::new_in_memory().unwrap();
        let session = store.create_session(None).unwrap();

        // Add messages
        let msg1 = store
            .add_message(&session.id, "user", "Hello", None, None)
            .unwrap();
        let msg2 = store
            .add_message(&session.id, "assistant", "Hi there!", None, None)
            .unwrap();

        // Get messages
        let messages = store.get_messages(&session.id, 10).unwrap();
        assert_eq!(messages.len(), 2);

        // Chronological order
        let messages = store.get_messages_chronological(&session.id, 10).unwrap();
        assert_eq!(messages[0].content, "Hello");
        assert_eq!(messages[1].content, "Hi there!");
    }

    #[test]
    fn test_fts_search() {
        let store = MemoryStore::new_in_memory().unwrap();
        let session = store.create_session(None).unwrap();

        store
            .add_message(&session.id, "user", "How do I use Rust?", None, None)
            .unwrap();
        store
            .add_message(&session.id, "assistant", "Rust is a systems language", None, None)
            .unwrap();
        store
            .add_message(&session.id, "user", "Tell me about Python", None, None)
            .unwrap();

        // Search
        let results = store.search("Rust", 10).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_curated_memory() {
        let store = MemoryStore::new_in_memory().unwrap();

        let memory = CuratedMemory {
            id: Uuid::new_v4().to_string(),
            memory_type: "fact".to_string(),
            content: "User prefers dark mode".to_string(),
            confidence: 0.9,
            source: "user_explicit".to_string(),
            created_at: MemoryStore::now(),
            last_used_at: MemoryStore::now(),
            use_count: 0,
            embedding: None,
        };

        // Save
        store.save_curated(&memory).unwrap();

        // Get
        let retrieved = store.get_curated(&memory.id).unwrap();
        assert!(retrieved.is_some());

        // Search
        let results = store.search_curated("dark mode", 10).unwrap();
        assert_eq!(results.len(), 1);

        // Touch (update usage)
        store.touch_curated(&memory.id).unwrap();
        let touched = store.get_curated(&memory.id).unwrap().unwrap();
        assert_eq!(touched.use_count, 1);

        // Delete
        store.delete_curated(&memory.id).unwrap();
        let deleted = store.get_curated(&memory.id).unwrap();
        assert!(deleted.is_none());
    }

    #[test]
    fn test_stats() {
        let store = MemoryStore::new_in_memory().unwrap();
        let session = store.create_session(None).unwrap();
        store
            .add_message(&session.id, "user", "Test", None, None)
            .unwrap();

        let stats = store.get_stats().unwrap();
        assert_eq!(stats.get("sessions"), Some(&1));
        assert_eq!(stats.get("messages"), Some(&1));
    }
}

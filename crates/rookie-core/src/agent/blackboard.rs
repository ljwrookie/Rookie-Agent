//! DashMap-based Blackboard with CAS operations and namespace isolation
//!
//! Provides a high-performance, thread-safe key-value store with:
//! - Compare-And-Swap (CAS) operations for concurrent updates
//! - Namespace isolation for multi-tenant scenarios
//! - Watch/notification system for key changes

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{debug, trace, warn};

/// Default channel capacity for watch notifications
const DEFAULT_WATCH_CAPACITY: usize = 1024;

/// Maximum number of watchers per key
const MAX_WATCHERS_PER_KEY: usize = 100;

/// Blackboard entry with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardEntry {
    /// The stored value
    pub value: Value,
    /// Entry version for optimistic concurrency control
    pub version: u64,
    /// Timestamp when entry was created/updated (Unix millis)
    pub timestamp: u64,
    /// Author/agent who wrote this entry
    pub author: String,
    /// Optional TTL in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<u64>,
}

impl BlackboardEntry {
    /// Create a new entry
    pub fn new(value: Value, author: impl Into<String>) -> Self {
        Self {
            value,
            version: 1,
            timestamp: current_timestamp_millis(),
            author: author.into(),
            ttl_ms: None,
        }
    }

    /// Check if entry has expired
    pub fn is_expired(&self) -> bool {
        match self.ttl_ms {
            Some(ttl) => current_timestamp_millis() > self.timestamp + ttl,
            None => false,
        }
    }

    /// Increment version and update timestamp
    fn bump(&mut self, author: impl Into<String>) {
        self.version += 1;
        self.timestamp = current_timestamp_millis();
        self.author = author.into();
    }
}

/// Change event for watch notifications
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardChangeEvent {
    /// Namespace where change occurred
    pub namespace: String,
    /// Key that changed
    pub key: String,
    /// New entry value (None if deleted)
    pub entry: Option<BlackboardEntry>,
    /// Previous version (0 for new keys)
    pub previous_version: u64,
    /// Event timestamp
    pub timestamp: u64,
}

/// Watch handle for unsubscribing
#[derive(Debug)]
pub struct WatchHandle {
    namespace: String,
    key: String,
    receiver: broadcast::Receiver<BlackboardChangeEvent>,
}

impl WatchHandle {
    /// Receive the next change event (async)
    pub async fn recv(&mut self) -> Result<BlackboardChangeEvent, broadcast::error::RecvError> {
        self.receiver.recv().await
    }

    /// Try to receive without blocking
    pub fn try_recv(&mut self) -> Result<BlackboardChangeEvent, broadcast::error::TryRecvError> {
        self.receiver.try_recv()
    }
}

/// Result of a CAS operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CasResult {
    /// CAS succeeded, value was updated
    Success,
    /// CAS failed, current version doesn't match expected
    VersionMismatch { current_version: u64 },
    /// Key doesn't exist
    KeyNotFound,
}

/// Inner storage for a namespace
struct NamespaceStorage {
    /// The actual key-value store
    data: DashMap<String, BlackboardEntry>,
    /// Watch senders for each key (key -> sender)
    watchers: DashMap<String, broadcast::Sender<BlackboardChangeEvent>>,
    /// Global counter for version generation
    version_counter: AtomicU64,
}

impl NamespaceStorage {
    fn new() -> Self {
        Self {
            data: DashMap::new(),
            watchers: DashMap::new(),
            version_counter: AtomicU64::new(1),
        }
    }

    fn next_version(&self) -> u64 {
        self.version_counter.fetch_add(1, Ordering::SeqCst)
    }
}

/// Thread-safe blackboard with namespace isolation
#[derive(Clone)]
pub struct Blackboard {
    /// Namespace -> storage mapping
    namespaces: Arc<DashMap<String, Arc<NamespaceStorage>>>,
    /// Global watch channel for all changes (wildcard "*")
    global_watcher: broadcast::Sender<BlackboardChangeEvent>,
}

impl Default for Blackboard {
    fn default() -> Self {
        Self::new()
    }
}

impl Blackboard {
    /// Create a new blackboard instance
    pub fn new() -> Self {
        let (global_watcher, _) = broadcast::channel(DEFAULT_WATCH_CAPACITY);
        Self {
            namespaces: Arc::new(DashMap::new()),
            global_watcher,
        }
    }

    /// Get or create namespace storage
    fn get_namespace(&self, namespace: &str) -> Arc<NamespaceStorage> {
        self.namespaces
            .entry(namespace.to_string())
            .or_insert_with(|| Arc::new(NamespaceStorage::new()))
            .clone()
    }

    /// Get a value from the blackboard
    pub fn get(&self, namespace: &str, key: &str) -> Option<BlackboardEntry> {
        let ns = self.namespaces.get(namespace)?;
        let entry = ns.data.get(key)?;
        if entry.is_expired() {
            drop(entry);
            self.delete(namespace, key, "system");
            return None;
        }
        Some(entry.clone())
    }

    /// Get raw JSON value
    pub fn get_value(&self, namespace: &str, key: &str) -> Option<Value> {
        self.get(namespace, key).map(|e| e.value)
    }

    /// Set a value in the blackboard
    pub fn set(
        &self,
        namespace: &str,
        key: &str,
        value: Value,
        author: &str,
    ) -> BlackboardEntry {
        let ns = self.get_namespace(namespace);
        let mut entry = BlackboardEntry::new(value, author);
        entry.version = ns.next_version();

        let previous_version = ns
            .data
            .get(key)
            .map(|e| e.version)
            .unwrap_or(0);

        ns.data.insert(key.to_string(), entry.clone());

        // Notify watchers
        self.notify_watchers(namespace, key, Some(entry.clone()), previous_version);

        debug!(namespace, key, author, "Blackboard set");
        entry
    }

    /// Set with TTL
    pub fn set_with_ttl(
        &self,
        namespace: &str,
        key: &str,
        value: Value,
        author: &str,
        ttl_ms: u64,
    ) -> BlackboardEntry {
        let ns = self.get_namespace(namespace);
        let mut entry = BlackboardEntry::new(value, author);
        entry.version = ns.next_version();
        entry.ttl_ms = Some(ttl_ms);

        let previous_version = ns
            .data
            .get(key)
            .map(|e| e.version)
            .unwrap_or(0);

        ns.data.insert(key.to_string(), entry.clone());
        self.notify_watchers(namespace, key, Some(entry.clone()), previous_version);

        entry
    }

    /// Compare-And-Swap operation
    ///
    /// Only updates the value if the current version matches `expected_version`.
    /// Returns CasResult indicating success or failure reason.
    pub fn cas(
        &self,
        namespace: &str,
        key: &str,
        expected_version: u64,
        value: Value,
        author: &str,
    ) -> CasResult {
        let ns = self.get_namespace(namespace);

        loop {
            // Try to get current entry
            let current = match ns.data.get(key) {
                Some(entry) => {
                    if entry.is_expired() {
                        drop(entry);
                        self.delete(namespace, key, "system");
                        return CasResult::KeyNotFound;
                    }
                    entry.clone()
                }
                None => return CasResult::KeyNotFound,
            };

            // Check version
            if current.version != expected_version {
                return CasResult::VersionMismatch {
                    current_version: current.version,
                };
            }

            // Attempt update using entry API for atomic operation
            let new_version = ns.next_version();
            let author_str: String = author.into();

            let entry = ns.data.entry(key.to_string());
            match entry {
                dashmap::mapref::entry::Entry::Occupied(mut occupied) => {
                    let current_entry = occupied.get();
                    if current_entry.version != expected_version {
                        return CasResult::VersionMismatch {
                            current_version: current_entry.version,
                        };
                    }

                    let mut new_entry = current_entry.clone();
                    new_entry.value = value.clone();
                    new_entry.bump(author_str);
                    new_entry.version = new_version;

                    occupied.insert(new_entry.clone());
                    self.notify_watchers(namespace, key, Some(new_entry), current.version);
                    debug!(namespace, key, author = author, expected_version, "CAS success");
                    return CasResult::Success;
                }
                dashmap::mapref::entry::Entry::Vacant(_) => {
                    return CasResult::KeyNotFound;
                }
            }
        }
    }

    /// Delete a key from the blackboard
    pub fn delete(&self, namespace: &str, key: &str, author: &str) -> Option<BlackboardEntry> {
        let ns = self.namespaces.get(namespace)?;
        let previous = ns.data.remove(key)?;

        self.notify_watchers(namespace, key, None, previous.1.version);

        debug!(namespace, key, author, "Blackboard delete");
        Some(previous.1)
    }

    /// Check if a key exists
    pub fn has(&self, namespace: &str, key: &str) -> bool {
        self.get(namespace, key).is_some()
    }

    /// List all keys in a namespace (optionally filtered by prefix)
    pub fn keys(&self, namespace: &str, prefix: Option<&str>) -> Vec<String> {
        let Some(ns) = self.namespaces.get(namespace) else {
            return vec![];
        };

        ns.data
            .iter()
            .filter(|e| {
                if let Some(p) = prefix {
                    e.key().starts_with(p) && !e.is_expired()
                } else {
                    !e.is_expired()
                }
            })
            .map(|e| e.key().clone())
            .collect()
    }

    /// Get all entries in a namespace as a snapshot
    pub fn snapshot(&self, namespace: &str) -> HashMap<String, BlackboardEntry> {
        let Some(ns) = self.namespaces.get(namespace) else {
            return HashMap::new();
        };

        ns.data
            .iter()
            .filter(|e| !e.is_expired())
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect()
    }

    /// Get raw JSON snapshot
    pub fn snapshot_values(&self, namespace: &str) -> HashMap<String, Value> {
        self.snapshot(namespace)
            .into_iter()
            .map(|(k, v)| (k, v.value))
            .collect()
    }

    /// Clear all entries in a namespace
    pub fn clear_namespace(&self, namespace: &str) -> usize {
        let Some(ns) = self.namespaces.get(namespace) else {
            return 0;
        };

        let keys: Vec<String> = ns.data.iter().map(|e| e.key().clone()).collect();
        for key in &keys {
            self.delete(namespace, key, "system");
        }
        keys.len()
    }

    /// Remove an entire namespace
    pub fn remove_namespace(&self, namespace: &str) -> bool {
        self.namespaces.remove(namespace).is_some()
    }

    /// List all namespaces
    pub fn list_namespaces(&self) -> Vec<String> {
        self.namespaces.iter().map(|e| e.key().clone()).collect()
    }

    /// Watch a specific key for changes
    ///
    /// Returns a WatchHandle that can be used to receive change events.
    /// The handle will receive events for the specified key only.
    pub fn watch(&self, namespace: &str, key: &str) -> Option<WatchHandle> {
        let ns = self.get_namespace(namespace);

        // Check watcher limit
        if ns.watchers.len() >= MAX_WATCHERS_PER_KEY * 10 {
            warn!(namespace, key, "Max watchers reached");
            return None;
        }

        let sender = ns
            .watchers
            .entry(key.to_string())
            .or_insert_with(|| {
                let (tx, _) = broadcast::channel(DEFAULT_WATCH_CAPACITY);
                tx
            })
            .clone();

        let receiver = sender.subscribe();

        Some(WatchHandle {
            namespace: namespace.to_string(),
            key: key.to_string(),
            receiver,
        })
    }

    /// Watch all changes in a namespace (wildcard)
    pub fn watch_namespace(&self, namespace: &str) -> broadcast::Receiver<BlackboardChangeEvent> {
        // For namespace-wide watching, we use the global channel
        // In production, you might want per-namespace channels
        self.global_watcher.subscribe()
    }

    /// Watch all changes across all namespaces
    pub fn watch_all(&self) -> broadcast::Receiver<BlackboardChangeEvent> {
        self.global_watcher.subscribe()
    }

    /// Get entry count in a namespace
    pub fn count(&self, namespace: &str) -> usize {
        let Some(ns) = self.namespaces.get(namespace) else {
            return 0;
        };
        ns.data.iter().filter(|e| !e.is_expired()).count()
    }

    /// Get total entry count across all namespaces
    pub fn total_count(&self) -> usize {
        self.namespaces
            .iter()
            .map(|ns| ns.data.iter().filter(|e| !e.is_expired()).count())
            .sum()
    }

    /// Notify watchers of a change
    fn notify_watchers(
        &self,
        namespace: &str,
        key: &str,
        entry: Option<BlackboardEntry>,
        previous_version: u64,
    ) {
        let event = BlackboardChangeEvent {
            namespace: namespace.to_string(),
            key: key.to_string(),
            entry,
            previous_version,
            timestamp: current_timestamp_millis(),
        };

        // Notify key-specific watchers
        if let Some(ns) = self.namespaces.get(namespace) {
            if let Some(sender) = ns.watchers.get(key) {
                let _ = sender.send(event.clone());
            }
        }

        // Notify global watchers
        let _ = self.global_watcher.send(event);
    }

    /// Clean up expired entries (can be called periodically)
    pub fn cleanup_expired(&self) -> usize {
        let mut cleaned = 0;
        for ns_entry in self.namespaces.iter() {
            let ns = ns_entry.value();
            let expired_keys: Vec<String> = ns
                .data
                .iter()
                .filter(|e| e.is_expired())
                .map(|e| e.key().clone())
                .collect();
            for key in expired_keys {
                ns.data.remove(&key);
                cleaned += 1;
            }
        }
        cleaned
    }
}

/// Get current timestamp in milliseconds
fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use tokio::time::timeout;

    #[test]
    fn test_basic_operations() {
        let bb = Blackboard::new();

        // Set and get
        bb.set("default", "key1", json!("value1"), "test");
        let entry = bb.get("default", "key1").unwrap();
        assert_eq!(entry.value, json!("value1"));
        assert_eq!(entry.author, "test");
        assert_eq!(entry.version, 1);

        // Update
        bb.set("default", "key1", json!("value2"), "test2");
        let entry = bb.get("default", "key1").unwrap();
        assert_eq!(entry.value, json!("value2"));
        assert_eq!(entry.author, "test2");
        assert_eq!(entry.version, 2);

        // Delete
        bb.delete("default", "key1", "test");
        assert!(bb.get("default", "key1").is_none());
    }

    #[test]
    fn test_namespace_isolation() {
        let bb = Blackboard::new();

        bb.set("ns1", "key", json!("value1"), "test");
        bb.set("ns2", "key", json!("value2"), "test");

        assert_eq!(bb.get_value("ns1", "key"), Some(json!("value1")));
        assert_eq!(bb.get_value("ns2", "key"), Some(json!("value2")));
    }

    #[test]
    fn test_cas_success() {
        let bb = Blackboard::new();

        bb.set("default", "key", json!("initial"), "test");
        let entry = bb.get("default", "key").unwrap();

        let result = bb.cas("default", "key", entry.version, json!("updated"), "test");
        assert_eq!(result, CasResult::Success);

        let updated = bb.get("default", "key").unwrap();
        assert_eq!(updated.value, json!("updated"));
        assert!(updated.version > entry.version);
    }

    #[test]
    fn test_cas_version_mismatch() {
        let bb = Blackboard::new();

        bb.set("default", "key", json!("initial"), "test");

        let result = bb.cas("default", "key", 999, json!("updated"), "test");
        match result {
            CasResult::VersionMismatch { current_version } => {
                assert_eq!(current_version, 1);
            }
            _ => panic!("Expected VersionMismatch"),
        }
    }

    #[test]
    fn test_cas_key_not_found() {
        let bb = Blackboard::new();

        let result = bb.cas("default", "nonexistent", 1, json!("value"), "test");
        assert_eq!(result, CasResult::KeyNotFound);
    }

    #[tokio::test]
    async fn test_watch() {
        let bb = Blackboard::new();

        let mut handle = bb.watch("default", "key").unwrap();

        // Trigger a change
        bb.set("default", "key", json!("value1"), "test");

        let event = timeout(Duration::from_millis(100), handle.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(event.namespace, "default");
        assert_eq!(event.key, "key");
        assert_eq!(event.entry.as_ref().unwrap().value, json!("value1"));
    }

    #[test]
    fn test_ttl() {
        let bb = Blackboard::new();

        // Set with very short TTL
        bb.set_with_ttl("default", "key", json!("value"), "test", 1);
        assert!(bb.has("default", "key"));

        // Wait for expiration
        std::thread::sleep(Duration::from_millis(10));
        assert!(!bb.has("default", "key"));
    }

    #[test]
    fn test_concurrent_writes() {
        use std::sync::Arc;
        use std::thread;

        let bb = Arc::new(Blackboard::new());
        let mut handles = vec![];

        // Spawn 100 threads, each writing 100 times
        for i in 0..100 {
            let bb = Arc::clone(&bb);
            let handle = thread::spawn(move || {
                for j in 0..100 {
                    let key = format!("key_{}", j);
                    let value = json!({ "thread": i, "iteration": j });
                    bb.set("concurrent", &key, value, &format!("thread_{}", i));
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Verify all 100 keys exist with correct final values
        for j in 0..100 {
            let key = format!("key_{}", j);
            assert!(bb.has("concurrent", &key), "Key {} should exist", key);
        }

        // Verify count
        assert_eq!(bb.count("concurrent"), 100);
    }

    #[test]
    fn test_cas_concurrent() {
        use std::sync::Arc;
        use std::thread;

        let bb = Arc::new(Blackboard::new());
        bb.set("cas_test", "counter", json!(0), "init");

        let mut handles = vec![];

        // Spawn threads that try to increment using CAS
        for _ in 0..10 {
            let bb = Arc::clone(&bb);
            let handle = thread::spawn(move || {
                for _ in 0..10 {
                    loop {
                        let entry = bb.get("cas_test", "counter").unwrap();
                        let current = entry.value.as_i64().unwrap();
                        let result = bb.cas(
                            "cas_test",
                            "counter",
                            entry.version,
                            json!(current + 1),
                            "incrementer",
                        );
                        if matches!(result, CasResult::Success) {
                            break;
                        }
                    }
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Counter should be exactly 100
        let final_value = bb.get("cas_test", "counter").unwrap().value.as_i64().unwrap();
        assert_eq!(final_value, 100);
    }

    #[test]
    fn test_snapshot() {
        let bb = Blackboard::new();

        bb.set("default", "key1", json!("value1"), "test");
        bb.set("default", "key2", json!("value2"), "test");

        let snapshot = bb.snapshot("default");
        assert_eq!(snapshot.len(), 2);
        assert!(snapshot.contains_key("key1"));
        assert!(snapshot.contains_key("key2"));
    }

    #[test]
    fn test_keys_with_prefix() {
        let bb = Blackboard::new();

        bb.set("default", "prefix:key1", json!("value1"), "test");
        bb.set("default", "prefix:key2", json!("value2"), "test");
        bb.set("default", "other:key", json!("value3"), "test");

        let keys = bb.keys("default", Some("prefix:"));
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(&"prefix:key1".to_string()));
        assert!(keys.contains(&"prefix:key2".to_string()));
    }
}

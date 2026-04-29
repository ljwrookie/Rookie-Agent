//! Memory Store Tests - P6-T2
//!
//! Tests for SQLite + FTS5 + Vector hybrid search

use rookie_core::memory::{CuratedMemory, MemoryStore};
use std::collections::HashMap;

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
        id: "mem-1".to_string(),
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
fn test_curated_by_type() {
    let store = MemoryStore::new_in_memory().unwrap();

    let fact = CuratedMemory {
        id: "fact-1".to_string(),
        memory_type: "fact".to_string(),
        content: "Fact content".to_string(),
        confidence: 0.8,
        source: "test".to_string(),
        created_at: MemoryStore::now(),
        last_used_at: MemoryStore::now(),
        use_count: 0,
        embedding: None,
    };

    let preference = CuratedMemory {
        id: "pref-1".to_string(),
        memory_type: "preference".to_string(),
        content: "Preference content".to_string(),
        confidence: 0.9,
        source: "test".to_string(),
        created_at: MemoryStore::now(),
        last_used_at: MemoryStore::now(),
        use_count: 0,
        embedding: None,
    };

    store.save_curated(&fact).unwrap();
    store.save_curated(&preference).unwrap();

    let facts = store.get_curated_by_type("fact", 10).unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].memory_type, "fact");

    let preferences = store.get_curated_by_type("preference", 10).unwrap();
    assert_eq!(preferences.len(), 1);
    assert_eq!(preferences[0].memory_type, "preference");
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

#[test]
fn test_multiple_sessions() {
    let store = MemoryStore::new_in_memory().unwrap();

    let session1 = store.create_session(Some("Session 1")).unwrap();
    let session2 = store.create_session(Some("Session 2")).unwrap();

    store.add_message(&session1.id, "user", "Message 1", None, None).unwrap();
    store.add_message(&session2.id, "user", "Message 2", None, None).unwrap();

    let messages1 = store.get_messages(&session1.id, 10).unwrap();
    let messages2 = store.get_messages(&session2.id, 10).unwrap();

    assert_eq!(messages1.len(), 1);
    assert_eq!(messages2.len(), 1);
    assert_eq!(messages1[0].content, "Message 1");
    assert_eq!(messages2[0].content, "Message 2");
}

#[test]
fn test_message_with_tool_calls() {
    let store = MemoryStore::new_in_memory().unwrap();
    let session = store.create_session(None).unwrap();

    let tool_calls = serde_json::json!([
        {
            "id": "call-1",
            "type": "function",
            "function": {
                "name": "file_read",
                "arguments": "{\"path\": \"/test.txt\"}"
            }
        }
    ]);

    store
        .add_message(&session.id, "assistant", "Reading file", Some(tool_calls), None)
        .unwrap();

    let messages = store.get_messages(&session.id, 10).unwrap();
    assert_eq!(messages.len(), 1);
    assert!(messages[0].tool_calls.is_some());
}

#[test]
fn test_update_nonexistent_session() {
    let store = MemoryStore::new_in_memory().unwrap();
    let result = store.update_session("nonexistent", Some("Title")).unwrap();
    assert!(!result);
}

#[test]
fn test_delete_nonexistent_session() {
    let store = MemoryStore::new_in_memory().unwrap();
    let result = store.delete_session("nonexistent").unwrap();
    assert!(!result);
}

#[test]
fn test_curated_with_embedding() {
    let store = MemoryStore::new_in_memory().unwrap();

    let embedding: Vec<f32> = vec![0.1, 0.2, 0.3, 0.4, 0.5];

    let memory = CuratedMemory {
        id: "mem-embed".to_string(),
        memory_type: "fact".to_string(),
        content: "Embedded memory".to_string(),
        confidence: 0.95,
        source: "test".to_string(),
        created_at: MemoryStore::now(),
        last_used_at: MemoryStore::now(),
        use_count: 0,
        embedding: Some(embedding),
    };

    store.save_curated(&memory).unwrap();

    let retrieved = store.get_curated(&memory.id).unwrap().unwrap();
    assert!(retrieved.embedding.is_some());
    assert_eq!(retrieved.embedding.unwrap().len(), 5);
}

#[test]
fn test_pagination() {
    let store = MemoryStore::new_in_memory().unwrap();

    // Create 20 sessions
    for i in 0..20 {
        store.create_session(Some(&format!("Session {}", i))).unwrap();
    }

    let page1 = store.list_sessions(10, 0).unwrap();
    let page2 = store.list_sessions(10, 10).unwrap();

    assert_eq!(page1.len(), 10);
    assert_eq!(page2.len(), 10);
}

#[test]
fn test_search_limit() {
    let store = MemoryStore::new_in_memory().unwrap();
    let session = store.create_session(None).unwrap();

    // Add 5 messages with "test"
    for i in 0..5 {
        store
            .add_message(&session.id, "user", &format!("test message {}", i), None, None)
            .unwrap();
    }

    let results = store.search("test", 3).unwrap();
    assert_eq!(results.len(), 3);
}

#[test]
fn test_clone_store() {
    let store = MemoryStore::new_in_memory().unwrap();
    let session = store.create_session(None).unwrap();
    store.add_message(&session.id, "user", "Test", None, None).unwrap();

    let cloned = store.clone();

    // Both should see the same data
    let stats1 = store.get_stats().unwrap();
    let stats2 = cloned.get_stats().unwrap();

    assert_eq!(stats1.get("sessions"), stats2.get("sessions"));
    assert_eq!(stats1.get("messages"), stats2.get("messages"));
}

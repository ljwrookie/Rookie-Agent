//! Blackboard concurrency and correctness tests

use rookie_core::agent::blackboard::{Blackboard, CasResult};
use serde_json::json;
use std::sync::Arc;
use std::thread;
use tokio::time::{sleep, Duration};

#[test]
fn test_basic_crud_operations() {
    let bb = Blackboard::new();

    // Create
    bb.set("default", "key1", json!("value1"), "test");
    let entry = bb.get("default", "key1").unwrap();
    assert_eq!(entry.value, json!("value1"));
    assert_eq!(entry.author, "test");
    assert_eq!(entry.version, 1);

    // Read
    assert_eq!(bb.get_value("default", "key1"), Some(json!("value1")));

    // Update
    bb.set("default", "key1", json!("value2"), "test2");
    let entry = bb.get("default", "key1").unwrap();
    assert_eq!(entry.value, json!("value2"));
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

    // Delete from one namespace shouldn't affect the other
    bb.delete("ns1", "key", "test");
    assert!(bb.get("ns1", "key").is_none());
    assert!(bb.get("ns2", "key").is_some());
}

#[test]
fn test_cas_operations() {
    let bb = Blackboard::new();

    // CAS on non-existent key should fail
    let result = bb.cas("default", "key", 1, json!("value"), "test");
    assert_eq!(result, CasResult::KeyNotFound);

    // Create initial value
    bb.set("default", "key", json!("initial"), "test");
    let entry = bb.get("default", "key").unwrap();

    // Successful CAS
    let result = bb.cas("default", "key", entry.version, json!("updated"), "test");
    assert_eq!(result, CasResult::Success);

    let updated = bb.get("default", "key").unwrap();
    assert_eq!(updated.value, json!("updated"));
    assert!(updated.version > entry.version);

    // Failed CAS (wrong version)
    let result = bb.cas("default", "key", entry.version, json!("stale"), "test");
    match result {
        CasResult::VersionMismatch { current_version } => {
            assert_eq!(current_version, updated.version);
        }
        _ => panic!("Expected VersionMismatch"),
    }
}

#[test]
fn test_ttl_expiration() {
    let bb = Blackboard::new();

    // Set with very short TTL (1ms)
    bb.set_with_ttl("default", "key", json!("value"), "test", 1);
    assert!(bb.has("default", "key"));

    // Wait for expiration
    std::thread::sleep(Duration::from_millis(10));

    // Key should be expired
    assert!(!bb.has("default", "key"));
}

#[test]
fn test_concurrent_writes_no_data_loss() {
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

    // Verify total writes (each key should have version >= 1)
    for j in 0..100 {
        let key = format!("key_{}", j);
        let entry = bb.get("concurrent", &key).unwrap();
        assert!(entry.version >= 1, "Key {} should have version >= 1", key);
    }
}

#[test]
fn test_cas_concurrent_counter() {
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

#[tokio::test]
async fn test_watch_notifications() {
    let bb = Blackboard::new();

    let mut handle = bb.watch("default", "key").unwrap();

    // Trigger a change
    bb.set("default", "key", json!("value1"), "test");

    let event = tokio::time::timeout(Duration::from_millis(100), handle.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(event.namespace, "default");
    assert_eq!(event.key, "key");
    assert_eq!(event.entry.as_ref().unwrap().value, json!("value1"));
}

#[test]
fn test_snapshot_operations() {
    let bb = Blackboard::new();

    bb.set("default", "key1", json!("value1"), "test");
    bb.set("default", "key2", json!("value2"), "test");
    bb.set("default", "prefix:key3", json!("value3"), "test");

    // Test full snapshot
    let snapshot = bb.snapshot("default");
    assert_eq!(snapshot.len(), 3);

    // Test snapshot values
    let values = bb.snapshot_values("default");
    assert_eq!(values.get("key1"), Some(&json!("value1")));
    assert_eq!(values.get("key2"), Some(&json!("value2")));

    // Test keys with prefix
    let keys = bb.keys("default", Some("prefix:"));
    assert_eq!(keys.len(), 1);
    assert!(keys.contains(&"prefix:key3".to_string()));
}

#[test]
fn test_namespace_management() {
    let bb = Blackboard::new();

    bb.set("ns1", "key", json!("value"), "test");
    bb.set("ns2", "key", json!("value"), "test");
    bb.set("ns3", "key", json!("value"), "test");

    // List namespaces
    let namespaces = bb.list_namespaces();
    assert_eq!(namespaces.len(), 3);

    // Clear namespace
    let cleared = bb.clear_namespace("ns1");
    assert_eq!(cleared, 1);
    assert_eq!(bb.count("ns1"), 0);

    // Remove namespace
    let removed = bb.remove_namespace("ns2");
    assert!(removed);
    assert!(!bb.list_namespaces().contains(&"ns2".to_string()));
}

#[test]
fn test_total_count() {
    let bb = Blackboard::new();

    bb.set("ns1", "key1", json!(1), "test");
    bb.set("ns1", "key2", json!(2), "test");
    bb.set("ns2", "key1", json!(3), "test");

    assert_eq!(bb.total_count(), 3);
}

#[test]
fn test_cleanup_expired() {
    let bb = Blackboard::new();

    // Set some keys with short TTL
    bb.set_with_ttl("default", "key1", json!("value"), "test", 1);
    bb.set_with_ttl("default", "key2", json!("value"), "test", 1);
    bb.set("default", "key3", json!("value"), "test"); // No TTL

    // Wait for expiration
    std::thread::sleep(Duration::from_millis(10));

    // Cleanup should remove expired keys
    let cleaned = bb.cleanup_expired();
    assert_eq!(cleaned, 2);

    assert!(!bb.has("default", "key1"));
    assert!(!bb.has("default", "key2"));
    assert!(bb.has("default", "key3"));
}

#[test]
fn test_high_concurrency_cas_no_deadlocks() {
    let bb = Arc::new(Blackboard::new());
    bb.set("stress", "counter", json!(0), "init");

    let mut handles = vec![];

    // Spawn many threads all doing CAS operations
    for i in 0..50 {
        let bb = Arc::clone(&bb);
        let handle = thread::spawn(move || {
            let mut successes = 0;
            let mut retries = 0;

            for _ in 0..20 {
                loop {
                    let entry = match bb.get("stress", "counter") {
                        Some(e) => e,
                        None => continue,
                    };
                    let current = entry.value.as_i64().unwrap_or(0);
                    let result = bb.cas(
                        "stress",
                        "counter",
                        entry.version,
                        json!(current + 1),
                        &format!("thread_{}", i),
                    );

                    match result {
                        CasResult::Success => {
                            successes += 1;
                            break;
                        }
                        CasResult::VersionMismatch { .. } => {
                            retries += 1;
                            if retries > 100 {
                                panic!("Too many retries");
                            }
                        }
                        CasResult::KeyNotFound => continue,
                    }
                }
            }

            (successes, retries)
        });
        handles.push(handle);
    }

    let mut total_successes = 0;
    let mut total_retries = 0;

    for handle in handles {
        let (successes, retries) = handle.join().unwrap();
        total_successes += successes;
        total_retries += retries;
    }

    // All 1000 increments should have succeeded
    assert_eq!(total_successes, 1000);

    // Final counter value should be 1000
    let final_value = bb.get("stress", "counter").unwrap().value.as_i64().unwrap();
    assert_eq!(final_value, 1000);
}

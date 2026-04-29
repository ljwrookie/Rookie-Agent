//! Vector Index Tests - P6-T2
//!
//! Tests for HNSW vector search implementation

use rookie_core::memory::vector::{VectorIndex, create_index};

fn create_test_vector(dim: usize, seed: u64) -> Vec<f32> {
    let mut vec = Vec::with_capacity(dim);
    let mut val = seed as f32;
    for _ in 0..dim {
        vec.push(val.sin());
        val += 0.1;
    }
    vec
}

#[test]
fn test_basic_operations() {
    let index = VectorIndex::with_defaults(10);

    // Add vectors
    for i in 0..100 {
        index.add(i, create_test_vector(10, i));
    }

    assert_eq!(index.len(), 100);

    // Search
    let query = create_test_vector(10, 50);
    let results = index.search(&query, 5);

    assert_eq!(results.len(), 5);
    // The closest vector should be the one we created with seed 50
    assert_eq!(results[0].0, 50);

    // Get
    let vec = index.get(50);
    assert!(vec.is_some());

    // Delete
    assert!(index.delete(50));
    assert!(index.get(50).is_none());
    assert_eq!(index.len(), 99);
}

#[test]
fn test_empty_search() {
    let index = VectorIndex::with_defaults(10);
    let query = create_test_vector(10, 0);
    let results = index.search(&query, 5);
    assert!(results.is_empty());
}

#[test]
fn test_clear() {
    let index = VectorIndex::with_defaults(10);

    for i in 0..10 {
        index.add(i, create_test_vector(10, i));
    }

    index.clear();
    assert!(index.is_empty());
    assert_eq!(index.len(), 0);
}

#[test]
fn test_stats() {
    let index = VectorIndex::with_defaults(10);

    for i in 0..10 {
        index.add(i, create_test_vector(10, i));
    }

    let stats = index.stats();
    assert_eq!(stats.get("nodes"), Some(&10));
    assert_eq!(stats.get("dimension"), Some(&10));
}

#[test]
fn test_search_accuracy() {
    let index = VectorIndex::new(10, 16, 100, 20);

    // Add vectors with known positions
    for i in 0..50 {
        let mut vec = vec![0.0; 10];
        vec[0] = i as f32;
        index.add(i, vec);
    }

    // Search for vector closest to 25
    let query = vec![25.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let results = index.search(&query, 3);

    assert!(!results.is_empty());
    // Should find vectors near 25
    let top_id = results[0].0;
    assert!(top_id >= 20 && top_id <= 30, "Expected ID near 25, got {}", top_id);
}

#[test]
fn test_delete_and_readd() {
    let index = VectorIndex::with_defaults(10);

    index.add(1, create_test_vector(10, 1));
    assert!(index.delete(1));
    assert!(index.get(1).is_none());

    // Re-add with same ID
    index.add(1, create_test_vector(10, 100));
    assert!(index.get(1).is_some());
}

#[test]
fn test_large_dimension() {
    let index = VectorIndex::with_defaults(1536); // OpenAI embedding size

    for i in 0..10 {
        index.add(i, create_test_vector(1536, i));
    }

    let query = create_test_vector(1536, 5);
    let results = index.search(&query, 3);

    assert_eq!(results.len(), 3);
}

#[test]
fn test_shared_index() {
    let index = create_index(10);

    index.add(1, create_test_vector(10, 1));
    index.add(2, create_test_vector(10, 2));

    let query = create_test_vector(10, 1);
    let results = index.search(&query, 2);

    assert_eq!(results.len(), 2);
}

#[test]
fn test_multiple_searches() {
    let index = VectorIndex::with_defaults(10);

    for i in 0..100 {
        index.add(i, create_test_vector(10, i));
    }

    // Perform multiple searches
    for i in 0..10 {
        let query = create_test_vector(10, i * 10);
        let results = index.search(&query, 5);
        assert_eq!(results.len(), 5);
    }
}

#[test]
fn test_search_different_k() {
    let index = VectorIndex::with_defaults(10);

    for i in 0..50 {
        index.add(i, create_test_vector(10, i));
    }

    let query = create_test_vector(10, 25);

    let results_1 = index.search(&query, 1);
    assert_eq!(results_1.len(), 1);

    let results_10 = index.search(&query, 10);
    assert_eq!(results_10.len(), 10);

    let results_100 = index.search(&query, 100);
    assert_eq!(results_100.len(), 50); // Can't return more than we have
}

#[test]
#[should_panic(expected = "Vector dimension mismatch")]
fn test_dimension_mismatch() {
    let index = VectorIndex::with_defaults(10);
    index.add(1, create_test_vector(20, 1)); // Wrong dimension
}

#[test]
fn test_is_empty() {
    let index = VectorIndex::with_defaults(10);
    assert!(index.is_empty());

    index.add(1, create_test_vector(10, 1));
    assert!(!index.is_empty());
}

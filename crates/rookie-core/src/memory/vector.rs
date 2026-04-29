//! Vector Index using HNSW (Hierarchical Navigable Small World) algorithm
//!
//! Provides approximate nearest neighbor search for semantic embeddings.
//! Uses a simple in-memory HNSW implementation optimized for Rookie Agent's needs.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{Arc, RwLock};

/// Vector with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorEntry {
    pub id: u64,
    pub vector: Vec<f32>,
    pub metadata: Option<serde_json::Value>,
}

/// HNSW graph node
#[derive(Debug, Clone)]
struct Node {
    id: u64,
    vector: Vec<f32>,
    layers: Vec<Vec<u64>>, // Connections at each layer
}

/// Search result with distance
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub id: u64,
    pub distance: f32,
}

impl PartialEq for SearchResult {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for SearchResult {}

impl PartialOrd for SearchResult {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        // Reverse ordering for min-heap (smallest distance first)
        other.distance.partial_cmp(&self.distance)
    }
}

impl Ord for SearchResult {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(other).unwrap_or(Ordering::Equal)
    }
}

/// HNSW Vector Index
///
/// Implements the HNSW algorithm for efficient approximate nearest neighbor search.
/// Optimized for embedding dimensions typically used in LLM applications (384-1536 dims).
pub struct VectorIndex {
    nodes: RwLock<HashMap<u64, Node>>,
    entry_point: RwLock<Option<u64>>,
    max_layers: usize,
    max_connections: usize,
    ef_construction: usize,
    ef_search: usize,
    dimension: usize,
    level_multiplier: f64,
}

impl VectorIndex {
    /// Create a new HNSW index
    ///
    /// # Arguments
    /// * `dimension` - Vector dimension (e.g., 384 for small embeddings, 1536 for OpenAI)
    /// * `max_connections` - Maximum connections per node per layer (M parameter)
    /// * `ef_construction` - Size of dynamic candidate list during construction
    /// * `ef_search` - Size of dynamic candidate list during search
    pub fn new(
        dimension: usize,
        max_connections: usize,
        ef_construction: usize,
        ef_search: usize,
    ) -> Self {
        let level_multiplier = 1.0 / (max_connections as f64).ln();

        Self {
            nodes: RwLock::new(HashMap::new()),
            entry_point: RwLock::new(None),
            max_layers: 16,
            max_connections,
            ef_construction,
            ef_search,
            dimension,
            level_multiplier,
        }
    }

    /// Create with default parameters for typical embedding sizes
    pub fn with_defaults(dimension: usize) -> Self {
        Self::new(dimension, 16, 200, 50)
    }

    /// Get current node count
    pub fn len(&self) -> usize {
        self.nodes.read().unwrap().len()
    }

    /// Check if index is empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Add a vector to the index
    pub fn add(&self, id: u64, vector: Vec<f32>) {
        assert_eq!(
            vector.len(),
            self.dimension,
            "Vector dimension mismatch: expected {}, got {}",
            self.dimension,
            vector.len()
        );

        let level = self.random_level();
        let node = Node {
            id,
            vector: vector.clone(),
            layers: vec![Vec::new(); level + 1],
        };

        let mut nodes = self.nodes.write().unwrap();

        // If this is the first node, set as entry point
        if nodes.is_empty() {
            nodes.insert(id, node);
            *self.entry_point.write().unwrap() = Some(id);
            return;
        }

        // Find entry point for insertion
        let mut current_ep = self.entry_point.read().unwrap().unwrap();
        let max_layer = nodes.get(&current_ep).map(|n| n.layers.len()).unwrap_or(0) - 1;

        // Search from top layer down to layer 0
        for layer in (0..=max_layer.min(level)).rev() {
            let candidates = self.search_layer(&nodes, current_ep, &vector, 1, layer);
            if let Some(best) = candidates.first() {
                current_ep = best.id;
            }
        }

        // Insert at each layer
        for layer in 0..=level {
            let m = if layer == 0 {
                self.max_connections * 2
            } else {
                self.max_connections
            };

            let candidates = self.search_layer(&nodes, current_ep, &vector, self.ef_construction, layer);
            let neighbors: Vec<u64> = candidates
                .into_iter()
                .filter(|r| r.id != id)
                .take(m)
                .map(|r| r.id)
                .collect();

            // Add bidirectional connections
            for &neighbor_id in &neighbors {
                if let Some(neighbor) = nodes.get_mut(&neighbor_id) {
                    if layer < neighbor.layers.len() {
                        neighbor.layers[layer].push(id);
                        // Trim if too many connections
                        if neighbor.layers[layer].len() > m {
                            let max_conn = self.max_connections;
                            neighbor.layers[layer].truncate(max_conn);
                        }
                    }
                }
            }
        }

        nodes.insert(id, node);

        // Update entry point if this node has higher layer
        let mut entry = self.entry_point.write().unwrap();
        if let Some(ep_id) = *entry {
            if let Some(ep_node) = nodes.get(&ep_id) {
                if level > ep_node.layers.len() - 1 {
                    *entry = Some(id);
                }
            }
        }
    }

    /// Search for nearest neighbors
    ///
    /// Returns top-k results with their distances
    pub fn search(&self, query: &[f32], k: usize) -> Vec<(u64, f64)> {
        assert_eq!(
            query.len(),
            self.dimension,
            "Query dimension mismatch: expected {}, got {}",
            self.dimension,
            query.len()
        );

        let nodes = self.nodes.read().unwrap();
        let entry = self.entry_point.read().unwrap();

        if nodes.is_empty() || entry.is_none() {
            return vec![];
        }

        let query_vec: Vec<f32> = query.to_vec();
        let mut current_ep = entry.unwrap();
        let max_layer = nodes.get(&current_ep).map(|n| n.layers.len()).unwrap_or(0) - 1;

        // Search from top layer down
        for layer in (1..=max_layer).rev() {
            let candidates = self.search_layer(&nodes, current_ep, &query_vec, 1, layer);
            if let Some(best) = candidates.first() {
                current_ep = best.id;
            }
        }

        // Final search at layer 0 with ef_search
        let results = self.search_layer(&nodes, current_ep, &query_vec, self.ef_search.max(k), 0);

        results
            .into_iter()
            .take(k)
            .map(|r| (r.id, r.distance as f64))
            .collect()
    }

    /// Delete a vector from the index
    pub fn delete(&self, id: u64) -> bool {
        let mut nodes = self.nodes.write().unwrap();

        if !nodes.contains_key(&id) {
            return false;
        }

        // Remove connections to this node from all other nodes
        for node in nodes.values_mut() {
            for layer in &mut node.layers {
                layer.retain(|&conn_id| conn_id != id);
            }
        }

        // Remove the node
        nodes.remove(&id);

        // Update entry point if necessary
        let mut entry = self.entry_point.write().unwrap();
        if *entry == Some(id) {
            *entry = nodes.keys().copied().next();
        }

        true
    }

    /// Get vector by ID
    pub fn get(&self, id: u64) -> Option<Vec<f32>> {
        self.nodes
            .read()
            .unwrap()
            .get(&id)
            .map(|n| n.vector.clone())
    }

    /// Clear all vectors
    pub fn clear(&self) {
        self.nodes.write().unwrap().clear();
        *self.entry_point.write().unwrap() = None;
    }

    /// Search a specific layer
    fn search_layer(
        &self,
        nodes: &HashMap<u64, Node>,
        entry_id: u64,
        query: &[f32],
        ef: usize,
        layer: usize,
    ) -> Vec<SearchResult> {
        let mut visited = HashMap::new();
        let mut candidates = BinaryHeap::new();
        let mut results = BinaryHeap::new();

        if let Some(entry) = nodes.get(&entry_id) {
            let dist = Self::euclidean_distance(query, &entry.vector);
            visited.insert(entry_id, dist);
            candidates.push(SearchResult {
                id: entry_id,
                distance: dist,
            });
            results.push(SearchResult {
                id: entry_id,
                distance: dist,
            });
        }

        while let Some(current) = candidates.pop() {
            let worst_result = results.peek().map(|r| r.distance).unwrap_or(f32::INFINITY);

            if current.distance > worst_result {
                break;
            }

            if let Some(node) = nodes.get(&current.id) {
                if layer < node.layers.len() {
                    for &neighbor_id in &node.layers[layer] {
                        if visited.contains_key(&neighbor_id) {
                            continue;
                        }

                        if let Some(neighbor) = nodes.get(&neighbor_id) {
                            let dist = Self::euclidean_distance(query, &neighbor.vector);
                            visited.insert(neighbor_id, dist);

                            let worst = results.peek().map(|r| r.distance).unwrap_or(f32::INFINITY);
                            if dist < worst || results.len() < ef {
                                candidates.push(SearchResult {
                                    id: neighbor_id,
                                    distance: dist,
                                });
                                results.push(SearchResult {
                                    id: neighbor_id,
                                    distance: dist,
                                });

                                if results.len() > ef {
                                    results.pop();
                                }
                            }
                        }
                    }
                }
            }
        }

        results.into_sorted_vec()
    }

    /// Trim connections to maintain max_connections limit
    fn trim_connections(
        &self,
        connections: &mut Vec<u64>,
        nodes: &HashMap<u64, Node>,
        _layer: usize,
    ) {
        if connections.len() <= self.max_connections {
            return;
        }

        // Keep the most diverse connections (simple heuristic: keep first M)
        // A more sophisticated approach would use distance-based selection
        connections.truncate(self.max_connections);
    }

    /// Calculate Euclidean distance between two vectors
    fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x - y).powi(2))
            .sum::<f32>()
            .sqrt()
    }

    /// Calculate cosine similarity between two vectors
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot / (norm_a * norm_b)
        }
    }

    /// Generate random level for new node
    fn random_level(&self) -> usize {
        let mut level = 0;
        let mut rng = fastrand::f64;

        while level < self.max_layers - 1 && rng() < self.level_multiplier {
            level += 1;
        }

        level
    }

    /// Get index statistics
    pub fn stats(&self) -> HashMap<String, usize> {
        let nodes = self.nodes.read().unwrap();
        let mut stats = HashMap::new();

        stats.insert("nodes".to_string(), nodes.len());
        stats.insert("dimension".to_string(), self.dimension);
        stats.insert("max_connections".to_string(), self.max_connections);

        let total_connections: usize = nodes
            .values()
            .map(|n| n.layers.iter().map(|l| l.len()).sum::<usize>())
            .sum();
        stats.insert("total_connections".to_string(), total_connections);

        stats
    }
}

impl Default for VectorIndex {
    fn default() -> Self {
        Self::with_defaults(384) // Default to 384-dim embeddings
    }
}

/// Thread-safe wrapper for VectorIndex
pub type SharedVectorIndex = Arc<VectorIndex>;

/// Create a new shared vector index
pub fn create_index(dimension: usize) -> SharedVectorIndex {
    Arc::new(VectorIndex::with_defaults(dimension))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

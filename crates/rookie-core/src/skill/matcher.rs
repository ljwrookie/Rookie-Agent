//! Skill Matcher Engine with HNSW indexing for semantic matching
//!
//! This module provides:
//! - Text embedding generation (simplified statistical approach)
//! - HNSW (Hierarchical Navigable Small World) index for approximate nearest neighbor search
//! - Skill matching based on semantic similarity

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for embedding generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingConfig {
    /// Dimension of the embedding vector
    pub dimension: usize,
    /// Random seed for reproducible embeddings
    pub seed: u64,
    /// Number of hash functions for feature hashing
    pub num_hashes: usize,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            dimension: 128,
            seed: 42,
            num_hashes: 4,
        }
    }
}

/// A skill entry in the matcher
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillEntry {
    /// Unique identifier for the skill
    pub id: String,
    /// Skill name
    pub name: String,
    /// Skill description for semantic matching
    pub description: String,
    /// Pre-computed embedding vector
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    /// Additional metadata
    pub metadata: HashMap<String, serde_json::Value>,
}

impl SkillEntry {
    pub fn new(id: String, name: String, description: String) -> Self {
        Self {
            id,
            name,
            description,
            embedding: None,
            metadata: HashMap::new(),
        }
    }

    /// Add metadata to the skill entry
    pub fn with_metadata(mut self, key: &str, value: serde_json::Value) -> Self {
        self.metadata.insert(key.to_string(), value);
        self
    }
}

/// Match result containing skill and similarity score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    /// The matched skill
    pub skill: SkillEntry,
    /// Similarity score (0.0 to 1.0)
    pub score: f32,
    /// Rank in results (1-based)
    pub rank: usize,
}

/// HNSW index node
#[derive(Debug, Clone)]
struct HnswNode {
    id: String,
    embedding: Vec<f32>,
    /// Layer connections: layer_index -> connected node ids
    connections: Vec<Vec<String>>,
}

/// HNSW (Hierarchical Navigable Small World) index
#[derive(Debug)]
struct HnswIndex {
    nodes: HashMap<String, HnswNode>,
    /// Entry point for search (highest layer)
    entry_point: Option<String>,
    /// Max layer in the index
    max_layer: usize,
    /// Configuration parameters
    m: usize,           // Max connections per layer
    ef_construction: usize,
    ef_search: usize,
    /// Random seed for layer assignment
    seed: u64,
}

impl HnswIndex {
    fn new(m: usize, ef_construction: usize, ef_search: usize, seed: u64) -> Self {
        Self {
            nodes: HashMap::new(),
            entry_point: None,
            max_layer: 0,
            m,
            ef_construction,
            ef_search,
            seed,
        }
    }

    /// Insert a new node into the index
    fn insert(&mut self, id: String, embedding: Vec<f32>) {
        // Determine layer using probabilistic distribution
        let layer = self.random_layer();
        
        let mut connections: Vec<Vec<String>> = Vec::with_capacity(layer + 1);
        for _ in 0..=layer {
            connections.push(Vec::new());
        }

        let node = HnswNode {
            id: id.clone(),
            embedding: embedding.clone(),
            connections,
        };

        // If index is empty, set as entry point
        if self.entry_point.is_none() {
            self.entry_point = Some(id.clone());
            self.max_layer = layer;
            self.nodes.insert(id, node);
            return;
        }

        // Search for nearest neighbors and connect
        let entry = self.entry_point.clone().unwrap();
        let mut current_entry = entry;

        // Search from top layer down to insertion layer
        for lc in (layer + 1..=self.max_layer).rev() {
            current_entry = self.search_layer_nearest(&current_entry, &embedding, lc);
        }

        // Connect in each layer from insertion layer down to 0
        for lc in (0..=layer.min(self.max_layer)).rev() {
            let neighbors = self.search_layer_knn(&current_entry, &embedding, lc, self.m);
            
            // Connect bidirectionally
            for neighbor_id in &neighbors {
                if neighbor_id != &id {
                    // Add connection from new node to neighbor
                    if let Some(node) = self.nodes.get_mut(&id) {
                        if node.connections.len() > lc {
                            node.connections[lc].push(neighbor_id.clone());
                        }
                    }
                    // Add connection from neighbor to new node
                    if let Some(neighbor) = self.nodes.get_mut(neighbor_id) {
                        if neighbor.connections.len() > lc && !neighbor.connections[lc].contains(&id) {
                            neighbor.connections[lc].push(id.clone());
                            // Prune if too many connections
                            if neighbor.connections[lc].len() > self.m * 2 {
                                self.prune_connections(neighbor_id, lc);
                            }
                        }
                    }
                }
            }
            
            if lc > 0 {
                current_entry = self.search_layer_nearest(&current_entry, &embedding, lc);
            }
        }

        // Update max layer if necessary
        if layer > self.max_layer {
            self.max_layer = layer;
            self.entry_point = Some(id.clone());
        }

        self.nodes.insert(id, node);
    }

    /// Search for k nearest neighbors
    fn search(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        if self.nodes.is_empty() {
            return Vec::new();
        }

        let entry = match &self.entry_point {
            Some(e) => e.clone(),
            None => return Vec::new(),
        };

        let ef = self.ef_search.max(k);
        let mut current = entry;

        // Search from top layer down
        for layer in (1..=self.max_layer).rev() {
            current = self.search_layer_nearest(&current, query, layer);
        }

        // Search in layer 0 with ef
        self.search_layer_knn_with_distances(&current, query, 0, ef)
            .into_iter()
            .take(k)
            .collect()
    }

    /// Search for nearest neighbor in a specific layer
    fn search_layer_nearest(&self, entry: &str, query: &[f32], layer: usize) -> String {
        let mut current = entry.to_string();
        let mut visited = std::collections::HashSet::new();
        visited.insert(current.clone());

        loop {
            let node = match self.nodes.get(&current) {
                Some(n) => n,
                None => break,
            };

            if layer >= node.connections.len() {
                break;
            }

            let mut nearest = current.clone();
            let mut min_dist = self.distance(query, &node.embedding);

            for neighbor_id in &node.connections[layer] {
                if visited.contains(neighbor_id) {
                    continue;
                }
                visited.insert(neighbor_id.clone());

                if let Some(neighbor) = self.nodes.get(neighbor_id) {
                    let dist = self.distance(query, &neighbor.embedding);
                    if dist < min_dist {
                        min_dist = dist;
                        nearest = neighbor_id.clone();
                    }
                }
            }

            if nearest == current {
                break;
            }
            current = nearest;
        }

        current
    }

    /// Search for k nearest neighbors in a specific layer
    fn search_layer_knn(&self, entry: &str, query: &[f32], layer: usize, k: usize) -> Vec<String> {
        self.search_layer_knn_with_distances(entry, query, layer, k)
            .into_iter()
            .map(|(id, _)| id)
            .collect()
    }

    /// Search for k nearest neighbors with distances
    fn search_layer_knn_with_distances(
        &self,
        entry: &str,
        query: &[f32],
        layer: usize,
        k: usize,
    ) -> Vec<(String, f32)> {
        use std::collections::BinaryHeap;
        use std::cmp::Ordering;

        #[derive(Clone)]
        struct Candidate {
            id: String,
            distance: f32,
        }

        impl Eq for Candidate {}
        impl PartialEq for Candidate {
            fn eq(&self, other: &Self) -> bool {
                self.distance == other.distance
            }
        }

        impl Ord for Candidate {
            fn cmp(&self, other: &Self) -> Ordering {
                other.distance.partial_cmp(&self.distance).unwrap_or(Ordering::Equal)
            }
        }

        impl PartialOrd for Candidate {
            fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
                Some(self.cmp(other))
            }
        }

        let mut visited = std::collections::HashSet::new();
        let mut candidates = BinaryHeap::new();
        let mut results = BinaryHeap::new();

        // Initialize with entry point
        if let Some(node) = self.nodes.get(entry) {
            let dist = self.distance(query, &node.embedding);
            candidates.push(Candidate {
                id: entry.to_string(),
                distance: dist,
            });
            visited.insert(entry.to_string());
        }

        while let Some(current) = candidates.pop() {
            // Add to results
            results.push(current.clone());
            if results.len() > k {
                results.pop();
            }

            // Check if we can stop (current distance is larger than worst in results)
            if results.len() >= k {
                if let Some(worst) = results.peek() {
                    if current.distance > worst.distance {
                        break;
                    }
                }
            }

            // Expand neighbors
            if let Some(node) = self.nodes.get(&current.id) {
                if layer < node.connections.len() {
                    for neighbor_id in &node.connections[layer] {
                        if visited.contains(neighbor_id) {
                            continue;
                        }
                        visited.insert(neighbor_id.clone());

                        if let Some(neighbor) = self.nodes.get(neighbor_id) {
                            let dist = self.distance(query, &neighbor.embedding);
                            candidates.push(Candidate {
                                id: neighbor_id.clone(),
                                distance: dist,
                            });
                        }
                    }
                }
            }
        }

        results.into_sorted_vec().into_iter().map(|c| (c.id, c.distance)).collect()
    }

    /// Calculate cosine distance (1 - cosine similarity)
    fn distance(&self, a: &[f32], b: &[f32]) -> f32 {
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        
        if norm_a == 0.0 || norm_b == 0.0 {
            return 1.0;
        }
        
        // Convert similarity to distance
        1.0 - (dot / (norm_a * norm_b))
    }

    /// Assign random layer using exponential distribution
    fn random_layer(&self) -> usize {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        self.seed.hash(&mut hasher);
        self.nodes.len().hash(&mut hasher);
        let hash = hasher.finish();

        // Exponential distribution: P(layer = l) = 1 / e^l
        let mut layer = 0;
        let mut h = hash;
        while h % 2 == 0 && layer < 16 {
            layer += 1;
            h /= 2;
        }
        layer
    }

    /// Prune connections to maintain index quality
    fn prune_connections(&mut self, node_id: &str, layer: usize) {
        if let Some(node) = self.nodes.get(node_id) {
            if layer >= node.connections.len() {
                return;
            }

            let connections: Vec<String> = node.connections[layer].clone();
            if connections.len() <= self.m {
                return;
            }

            // Keep only the closest connections
            let mut with_distances: Vec<(String, f32)> = connections
                .into_iter()
                .filter_map(|id| {
                    self.nodes.get(&id).map(|n| {
                        let dist = self.distance(&node.embedding, &n.embedding);
                        (id, dist)
                    })
                })
                .collect();

            with_distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            with_distances.truncate(self.m);

            let pruned: Vec<String> = with_distances.into_iter().map(|(id, _)| id).collect();
            
            if let Some(node) = self.nodes.get_mut(node_id) {
                node.connections[layer] = pruned;
            }
        }
    }

    fn len(&self) -> usize {
        self.nodes.len()
    }

    fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

/// Skill matcher with semantic search capabilities
pub struct SkillMatcher {
    config: EmbeddingConfig,
    index: HnswIndex,
    entries: HashMap<String, SkillEntry>,
    /// Vocabulary for feature hashing
    vocabulary: HashMap<String, usize>,
}

impl SkillMatcher {
    /// Create a new skill matcher with default configuration
    pub fn new() -> Self {
        Self::with_config(EmbeddingConfig::default())
    }

    /// Create a new skill matcher with custom configuration
    pub fn with_config(config: EmbeddingConfig) -> Self {
        Self {
            config: config.clone(),
            index: HnswIndex::new(16, 200, 50, config.seed),
            entries: HashMap::new(),
            vocabulary: HashMap::new(),
        }
    }

    /// Add a skill entry to the matcher
    pub fn add_skill(&mut self, entry: SkillEntry) {
        // Generate embedding if not already present
        let embedding = entry.embedding.clone().unwrap_or_else(|| {
            self.generate_embedding(&entry.description)
        });

        let mut entry_with_embedding = entry;
        entry_with_embedding.embedding = Some(embedding.clone());

        let id = entry_with_embedding.id.clone();
        
        // Insert into index
        self.index.insert(id.clone(), embedding);
        
        // Store entry
        self.entries.insert(id, entry_with_embedding);
    }

    /// Remove a skill entry
    pub fn remove_skill(&mut self, id: &str) -> Option<SkillEntry> {
        // Note: HNSW doesn't support deletion, so we just mark as removed
        // In production, would use lazy deletion or rebuild index periodically
        self.entries.remove(id)
    }

    /// Find matching skills for a query
    pub fn find_matches(&self, query: &str, top_k: usize) -> Vec<MatchResult> {
        if self.index.is_empty() {
            return Vec::new();
        }

        let query_embedding = self.generate_embedding(query);
        let results = self.index.search(&query_embedding, top_k);

        results
            .into_iter()
            .enumerate()
            .filter_map(|(rank, (id, distance))| {
                self.entries.get(&id).map(|entry| {
                    // Convert distance back to similarity score
                    let score = (1.0 - distance).max(0.0).min(1.0);
                    MatchResult {
                        skill: entry.clone(),
                        score,
                        rank: rank + 1,
                    }
                })
            })
            .collect()
    }

    /// Find the best matching skill
    pub fn find_best_match(&self, query: &str) -> Option<MatchResult> {
        self.find_matches(query, 1).into_iter().next()
    }

    /// Get all registered skills
    pub fn get_all_skills(&self) -> Vec<&SkillEntry> {
        self.entries.values().collect()
    }

    /// Get a specific skill by ID
    pub fn get_skill(&self, id: &str) -> Option<&SkillEntry> {
        self.entries.get(id)
    }

    /// Get number of registered skills
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Generate embedding using feature hashing (simplified approach)
    fn generate_embedding(&self, text: &str) -> Vec<f32> {
        let normalized = self.normalize_text(text);
        let tokens: Vec<&str> = normalized.split_whitespace().collect();
        
        let mut embedding = vec![0.0f32; self.config.dimension];
        
        for (i, token) in tokens.iter().enumerate() {
            // Feature hashing with multiple hash functions
            for h in 0..self.config.num_hashes {
                let hash = self.hash_token(token, h);
                let idx = (hash as usize) % self.config.dimension;
                let sign = if hash % 2 == 0 { 1.0 } else { -1.0 };
                
                // TF-IDF weighting approximation
                let tf = 1.0 + (tokens.len() as f32).ln();
                embedding[idx] += sign * tf;
            }
            
            // Position encoding (simplified)
            let pos_weight = 1.0 / (1.0 + (i as f32).ln_1p());
            let pos_idx = (i * 7) % self.config.dimension; // Prime multiplier for distribution
            embedding[pos_idx] += pos_weight;
        }

        // L2 normalize
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for val in &mut embedding {
                *val /= norm;
            }
        }

        embedding
    }

    /// Normalize text for embedding
    fn normalize_text(&self, text: &str) -> String {
        text.to_lowercase()
            .replace(|c: char| !c.is_alphanumeric() && c != ' ', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Hash a token with a seed
    fn hash_token(&self, token: &str, seed: usize) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        seed.hash(&mut hasher);
        hasher.finish()
    }

    /// Build vocabulary from all skill descriptions (for advanced embedding)
    pub fn build_vocabulary(&mut self, texts: &[String]) {
        for text in texts {
            let normalized = self.normalize_text(text);
            for token in normalized.split_whitespace() {
                let count = self.vocabulary.entry(token.to_string()).or_insert(0);
                *count += 1;
            }
        }
    }

    /// Calculate semantic similarity between two texts
    pub fn calculate_similarity(&self, text1: &str, text2: &str) -> f32 {
        let emb1 = self.generate_embedding(text1);
        let emb2 = self.generate_embedding(text2);
        
        let dot: f32 = emb1.iter().zip(emb2.iter()).map(|(a, b)| a * b).sum();
        let norm1: f32 = emb1.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm2: f32 = emb2.iter().map(|x| x * x).sum::<f32>().sqrt();
        
        if norm1 == 0.0 || norm2 == 0.0 {
            return 0.0;
        }
        
        (dot / (norm1 * norm2)).max(0.0).min(1.0)
    }
}

impl Default for SkillMatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_entry_creation() {
        let entry = SkillEntry::new(
            "test-1".to_string(),
            "Test Skill".to_string(),
            "A test skill for unit testing".to_string(),
        );
        
        assert_eq!(entry.id, "test-1");
        assert_eq!(entry.name, "Test Skill");
        assert!(entry.embedding.is_none());
    }

    #[test]
    fn test_matcher_add_and_find() {
        let mut matcher = SkillMatcher::new();
        
        let entry = SkillEntry::new(
            "code-review".to_string(),
            "Code Review".to_string(),
            "Review code for quality and bugs".to_string(),
        );
        
        matcher.add_skill(entry);
        assert_eq!(matcher.len(), 1);
        
        let matches = matcher.find_matches("check my code", 3);
        assert!(!matches.is_empty());
        assert_eq!(matches[0].skill.name, "Code Review");
    }

    #[test]
    fn test_semantic_similarity() {
        let matcher = SkillMatcher::new();
        
        let sim = matcher.calculate_similarity(
            "review code quality",
            "check code for bugs"
        );
        
        assert!(sim > 0.0);
        assert!(sim <= 1.0);
    }

    #[test]
    fn test_hnsw_index() {
        let mut index = HnswIndex::new(16, 200, 50, 42);
        
        // Insert some vectors
        for i in 0..10 {
            let vec: Vec<f32> = (0..128).map(|j| ((i * j) % 10) as f32 / 10.0).collect();
            index.insert(format!("node-{}", i), vec);
        }
        
        assert_eq!(index.len(), 10);
        
        // Search
        let query: Vec<f32> = (0..128).map(|j| (j % 10) as f32 / 10.0).collect();
        let results = index.search(&query, 3);
        assert!(!results.is_empty());
    }
}

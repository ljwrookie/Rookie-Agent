//! Skill Matcher Tests (P8-T1)

use rookie_core::skill::{EmbeddingConfig, SkillEntry, SkillMatcher};

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
    assert!(entry.metadata.is_empty());
}

#[test]
fn test_skill_entry_with_metadata() {
    let entry = SkillEntry::new(
        "test-2".to_string(),
        "Test Skill 2".to_string(),
        "Description".to_string(),
    )
    .with_metadata("key1", serde_json::json!("value1"))
    .with_metadata("key2", serde_json::json!(42));

    assert_eq!(entry.metadata.get("key1").unwrap(), "value1");
    assert_eq!(entry.metadata.get("key2").unwrap(), 42);
}

#[test]
fn test_matcher_new() {
    let matcher = SkillMatcher::new();
    assert_eq!(matcher.len(), 0);
    assert!(matcher.is_empty());
}

#[test]
fn test_matcher_with_config() {
    let config = EmbeddingConfig {
        dimension: 256,
        seed: 123,
        num_hashes: 8,
    };
    let matcher = SkillMatcher::with_config(config);
    assert_eq!(matcher.len(), 0);
}

#[test]
fn test_matcher_add_skill() {
    let mut matcher = SkillMatcher::new();

    let entry = SkillEntry::new(
        "code-review".to_string(),
        "Code Review".to_string(),
        "Review code for quality and bugs".to_string(),
    );

    matcher.add_skill(entry);
    assert_eq!(matcher.len(), 1);
    assert!(!matcher.is_empty());
}

#[test]
fn test_matcher_add_multiple_skills() {
    let mut matcher = SkillMatcher::new();

    let skills = vec![
        ("code-review", "Code Review", "Review code for quality"),
        ("refactor", "Refactor", "Refactor code for better structure"),
        ("test-gen", "Test Generator", "Generate unit tests"),
    ];

    for (id, name, desc) in skills {
        matcher.add_skill(SkillEntry::new(
            id.to_string(),
            name.to_string(),
            desc.to_string(),
        ));
    }

    assert_eq!(matcher.len(), 3);
}

#[test]
fn test_matcher_find_matches() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "code-review".to_string(),
        "Code Review".to_string(),
        "Review code for quality and bugs".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "refactor".to_string(),
        "Refactor".to_string(),
        "Refactor code for better structure".to_string(),
    ));

    let matches = matcher.find_matches("check my code", 3);
    assert!(!matches.is_empty());
    assert_eq!(matches[0].skill.name, "Code Review");
}

#[test]
fn test_matcher_find_best_match() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "code-review".to_string(),
        "Code Review".to_string(),
        "Review code for quality and bugs".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "refactor".to_string(),
        "Refactor".to_string(),
        "Refactor code for better structure".to_string(),
    ));

    let best = matcher.find_best_match("improve my code structure");
    assert!(best.is_some());
    assert_eq!(best.unwrap().skill.name, "Refactor");
}

#[test]
fn test_matcher_semantic_similarity() {
    let matcher = SkillMatcher::new();

    let sim1 = matcher.calculate_similarity("review code quality", "check code for bugs");
    let sim2 = matcher.calculate_similarity("review code quality", "deploy to production");

    // Similar queries should have higher similarity
    assert!(sim1 > sim2, "Semantic similarity should distinguish related concepts");
}

#[test]
fn test_matcher_remove_skill() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "code-review".to_string(),
        "Code Review".to_string(),
        "Review code".to_string(),
    ));

    assert_eq!(matcher.len(), 1);

    let removed = matcher.remove_skill("code-review");
    assert!(removed.is_some());
    assert_eq!(matcher.len(), 0);
}

#[test]
fn test_matcher_remove_nonexistent() {
    let mut matcher = SkillMatcher::new();

    let removed = matcher.remove_skill("nonexistent");
    assert!(removed.is_none());
}

#[test]
fn test_matcher_get_skill() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "code-review".to_string(),
        "Code Review".to_string(),
        "Review code".to_string(),
    ));

    let skill = matcher.get_skill("code-review");
    assert!(skill.is_some());
    assert_eq!(skill.unwrap().name, "Code Review");
}

#[test]
fn test_matcher_get_all_skills() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "skill-1".to_string(),
        "Skill 1".to_string(),
        "Description 1".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "skill-2".to_string(),
        "Skill 2".to_string(),
        "Description 2".to_string(),
    ));

    let all = matcher.get_all_skills();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_matcher_empty_query() {
    let matcher = SkillMatcher::new();
    let matches = matcher.find_matches("", 5);
    assert!(matches.is_empty());
}

#[test]
fn test_matcher_accuracy_threshold() {
    let mut matcher = SkillMatcher::new();

    // Add skills with distinct descriptions
    matcher.add_skill(SkillEntry::new(
        "rust-dev".to_string(),
        "Rust Development".to_string(),
        "Develop Rust applications with cargo and rustc".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "python-dev".to_string(),
        "Python Development".to_string(),
        "Develop Python applications with pip and pytest".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "js-dev".to_string(),
        "JavaScript Development".to_string(),
        "Develop JavaScript applications with npm and node".to_string(),
    ));

    // Test accuracy - should match correct language
    let rust_match = matcher.find_best_match("write rust code with cargo");
    assert!(rust_match.is_some());
    assert_eq!(rust_match.unwrap().skill.id, "rust-dev");

    let python_match = matcher.find_best_match("python flask django web");
    assert!(python_match.is_some());
    assert_eq!(python_match.unwrap().skill.id, "python-dev");

    let js_match = matcher.find_best_match("javascript node npm react");
    assert!(js_match.is_some());
    assert_eq!(js_match.unwrap().skill.id, "js-dev");
}

#[test]
fn test_embedding_config_default() {
    let config = EmbeddingConfig::default();
    assert_eq!(config.dimension, 128);
    assert_eq!(config.seed, 42);
    assert_eq!(config.num_hashes, 4);
}

#[test]
fn test_skill_with_precomputed_embedding() {
    let mut entry = SkillEntry::new(
        "embedded".to_string(),
        "Embedded Skill".to_string(),
        "Has precomputed embedding".to_string(),
    );

    entry.embedding = Some(vec![0.1, 0.2, 0.3, 0.4]);

    let mut matcher = SkillMatcher::new();
    matcher.add_skill(entry);

    // Should use precomputed embedding
    let skill = matcher.get_skill("embedded");
    assert!(skill.unwrap().embedding.is_some());
}

#[test]
fn test_matcher_ranking_consistency() {
    let mut matcher = SkillMatcher::new();

    matcher.add_skill(SkillEntry::new(
        "exact-match".to_string(),
        "Exact Match".to_string(),
        "This is an exact match for the query".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "related".to_string(),
        "Related".to_string(),
        "This is somewhat related to the query".to_string(),
    ));

    matcher.add_skill(SkillEntry::new(
        "unrelated".to_string(),
        "Unrelated".to_string(),
        "This has nothing to do with the query".to_string(),
    ));

    let matches = matcher.find_matches("exact match query", 3);
    assert_eq!(matches.len(), 3);
    
    // Scores should be in descending order
    for i in 1..matches.len() {
        assert!(
            matches[i - 1].score >= matches[i].score,
            "Results should be sorted by score descending"
        );
    }

    // Ranks should be sequential
    for (i, m) in matches.iter().enumerate() {
        assert_eq!(m.rank, i + 1);
    }
}

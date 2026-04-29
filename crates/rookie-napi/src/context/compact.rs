//! Stage 5: Compact - Auto-compact when over threshold

use crate::{PipelineMessage, PipelineStats};

/// Auto-compact messages when over threshold
pub fn auto_compact(
    messages: Vec<PipelineMessage>,
    context_window: usize,
    threshold: f64,
    stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    let estimated_tokens: usize = messages
        .iter()
        .map(|m| (m.content.len() + 3) / 4 + 4)
        .sum();

    let trigger_tokens = (context_window as f64 * threshold) as usize;

    if estimated_tokens < trigger_tokens {
        return messages;
    }

    // Need to compact - remove or summarize oldest non-system messages
    let system_msgs: Vec<_> = messages
        .iter()
        .filter(|m| m.role == "system")
        .cloned()
        .collect();
    let other_msgs: Vec<_> = messages
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect();

    // Keep half of other messages (at least 10)
    let keep_count = (other_msgs.len() / 2).max(10);
    let kept_msgs: Vec<_> = other_msgs.iter().rev().take(keep_count).rev().cloned().collect();

    let removed_count = other_msgs.len() - keep_count;
    stats.stage5_compacted = removed_count as u32;

    let summary = PipelineMessage {
        role: "system".to_string(),
        content: format!(
            "[Autocompacted: {} older messages removed to fit context window]",
            removed_count
        ),
        tool_calls: None,
        tool_call_id: None,
        metadata: Some(
            serde_json::json!({
                "_pipeline": "compacted",
                "_removedCount": removed_count
            })
            .to_string(),
        ),
    };

    let mut result = system_msgs;
    result.push(summary);
    result.extend(kept_msgs);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_message(role: &str, content: &str) -> PipelineMessage {
        PipelineMessage {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            metadata: None,
        }
    }

    #[test]
    fn test_no_compact_under_threshold() {
        let messages = vec![
            create_message("system", "You are helpful"),
            create_message("user", "Hello"),
        ];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = auto_compact(messages, 128000, 0.8, &mut stats);
        assert_eq!(result.len(), 2);
        assert_eq!(stats.stage5_compacted, 0);
    }

    #[test]
    fn test_compact_over_threshold() {
        // Create many long messages to trigger compaction
        let mut messages = vec![create_message("system", "You are helpful")];
        for i in 0..100 {
            messages.push(create_message("user", &"a".repeat(1000)));
            messages.push(create_message("assistant", &"b".repeat(1000)));
        }

        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = auto_compact(messages, 10000, 0.5, &mut stats);
        assert!(stats.stage5_compacted > 0);
        assert!(result.iter().any(|m| m.content.contains("Autocompacted")));
    }
}

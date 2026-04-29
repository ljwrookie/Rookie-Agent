//! Stage 1: Tool Budget - Apply tool result budget

use crate::{PipelineMessage, PipelineStats};

/// Apply budget to tool result messages
pub fn apply_tool_budget(
    messages: Vec<PipelineMessage>,
    max_tokens: usize,
    stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    messages
        .into_iter()
        .map(|msg| {
            if msg.role != "tool" {
                return msg;
            }

            let estimated_tokens = (msg.content.len() + 3) / 4;

            if estimated_tokens <= max_tokens {
                return msg;
            }

            // Truncate and add indicator
            let truncate_ratio = max_tokens as f64 / estimated_tokens as f64;
            let truncated_length = (msg.content.len() as f64 * truncate_ratio) as usize;
            let truncated = &msg.content[..truncated_length.min(msg.content.len())];

            stats.stage1_tool_results += 1;

            PipelineMessage {
                role: msg.role,
                content: format!(
                    "{}\n\n[... truncated: showing {} of ~{} tokens ...]",
                    truncated, max_tokens, estimated_tokens
                ),
                tool_calls: msg.tool_calls,
                tool_call_id: msg.tool_call_id,
                metadata: Some(
                    serde_json::json!({ "_pipeline": "tool_result_budget" }).to_string(),
                ),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_tool_message(content: &str) -> PipelineMessage {
        PipelineMessage {
            role: "tool".to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: Some("test_123".to_string()),
            metadata: None,
        }
    }

    #[test]
    fn test_tool_under_budget() {
        let messages = vec![create_tool_message("Short result")];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = apply_tool_budget(messages, 1000, &mut stats);
        assert_eq!(stats.stage1_tool_results, 0);
        assert!(!result[0].content.contains("truncated"));
    }

    #[test]
    fn test_tool_over_budget() {
        let long_content = "a".repeat(10000);
        let messages = vec![create_tool_message(&long_content)];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = apply_tool_budget(messages, 100, &mut stats);
        assert_eq!(stats.stage1_tool_results, 1);
        assert!(result[0].content.contains("truncated"));
    }
}

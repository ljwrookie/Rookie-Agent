//! Stage 2: Snip - Intelligently truncate long messages

use crate::{PipelineMessage, PipelineStats};

/// Snip long messages by keeping beginning and end
pub fn snip_messages(
    messages: Vec<PipelineMessage>,
    threshold: usize,
    stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    messages
        .into_iter()
        .map(|msg| {
            let estimated_tokens = (msg.content.len() + 3) / 4;

            if estimated_tokens <= threshold {
                return msg;
            }

            // Keep 80% of threshold: 40% front + 40% back
            let keep_tokens = (threshold as f64 * 0.8) as usize;
            let keep_chars = keep_tokens * 4;
            let front_chars = keep_chars / 2;
            let back_chars = keep_chars - front_chars;

            let content_len = msg.content.len();
            let front = &msg.content[..front_chars.min(content_len)];
            let back = if content_len > back_chars {
                &msg.content[content_len - back_chars..]
            } else {
                ""
            };

            let snipped = estimated_tokens - keep_tokens;
            stats.stage2_snipped += 1;

            PipelineMessage {
                role: msg.role.clone(),
                content: format!(
                    "{}\n\n[... {} tokens snipped ...]\n\n{}",
                    front, snipped, back
                ),
                tool_calls: msg.tool_calls,
                tool_call_id: msg.tool_call_id,
                metadata: Some(serde_json::json!({ "_pipeline": "snipped" }).to_string()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_message(content: &str) -> PipelineMessage {
        PipelineMessage {
            role: "assistant".to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            metadata: None,
        }
    }

    #[test]
    fn test_short_message_unchanged() {
        let messages = vec![create_message("Short message")];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = snip_messages(messages, 100, &mut stats);
        assert_eq!(stats.stage2_snipped, 0);
        assert!(!result[0].content.contains("snipped"));
    }

    #[test]
    fn test_long_message_snipped() {
        let long_content = "a".repeat(20000);
        let messages = vec![create_message(&long_content)];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = snip_messages(messages, 1000, &mut stats);
        assert_eq!(stats.stage2_snipped, 1);
        assert!(result[0].content.contains("snipped"));
    }
}

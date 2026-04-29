//! Stage 3: Normalize - Message format normalization

use crate::{PipelineMessage, PipelineStats};

/// Normalize message formatting
pub fn normalize_messages(
    messages: Vec<PipelineMessage>,
    stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    messages
        .into_iter()
        .map(|msg| {
            let original_content = msg.content.clone();
            let mut content = msg.content;

            // Remove consecutive empty lines (more than 2)
            content = content.replace("\n\n\n", "\n\n");
            while content.contains("\n\n\n") {
                content = content.replace("\n\n\n", "\n\n");
            }

            // Normalize indentation (convert tabs to 2 spaces)
            content = content.replace('\t', "  ");

            // Trim trailing whitespace per line
            content = content
                .lines()
                .map(|line| line.trim_end())
                .collect::<Vec<_>>()
                .join("\n");

            // Trim leading/trailing whitespace from entire message
            content = content.trim().to_string();

            // Check if changed
            let changed = content != original_content;
            if changed {
                stats.stage3_normalized += 1;
            }

            PipelineMessage {
                role: msg.role,
                content,
                tool_calls: msg.tool_calls,
                tool_call_id: msg.tool_call_id,
                metadata: if changed {
                    Some(serde_json::json!({ "_pipeline": "normalized" }).to_string())
                } else {
                    msg.metadata
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_message(content: &str) -> PipelineMessage {
        PipelineMessage {
            role: "user".to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            metadata: None,
        }
    }

    #[test]
    fn test_normalize_empty_lines() {
        let messages = vec![create_message("Line 1\n\n\n\nLine 2")];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = normalize_messages(messages, &mut stats);
        assert_eq!(stats.stage3_normalized, 1);
        assert_eq!(result[0].content, "Line 1\n\nLine 2");
    }

    #[test]
    fn test_normalize_tabs() {
        let messages = vec![create_message("Line 1\n\tLine 2")];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = normalize_messages(messages, &mut stats);
        assert_eq!(stats.stage3_normalized, 1);
        assert_eq!(result[0].content, "Line 1\n  Line 2");
    }

    #[test]
    fn test_no_change_needed() {
        let messages = vec![create_message("Clean message")];
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = normalize_messages(messages, &mut stats);
        assert_eq!(stats.stage3_normalized, 0);
        assert_eq!(result[0].content, "Clean message");
    }
}

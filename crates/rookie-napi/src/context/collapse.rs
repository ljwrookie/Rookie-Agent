//! Stage 4: Collapse - Merge consecutive same-role messages

use crate::{PipelineMessage, PipelineStats};

/// Collapse consecutive messages from the same role
pub fn collapse_messages(
    messages: Vec<PipelineMessage>,
    max_messages: usize,
    stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    if messages.len() <= max_messages {
        return messages;
    }

    // First, collapse consecutive same-role messages
    let mut collapsed: Vec<PipelineMessage> = Vec::new();
    let mut collapsed_count = 0;

    for msg in messages {
        if let Some(last) = collapsed.last_mut() {
            if last.role == msg.role && last.role != "system" {
                // Merge with previous message
                last.content.push_str("\n\n");
                last.content.push_str(&msg.content);
                
                // Merge metadata if present
                if let Some(ref meta) = msg.metadata {
                    let merged_meta = if let Some(ref last_meta) = last.metadata {
                        format!("{}; {}", last_meta, meta)
                    } else {
                        meta.clone()
                    };
                    last.metadata = Some(merged_meta);
                }
                
                collapsed_count += 1;
                continue;
            }
        }
        collapsed.push(msg);
    }

    stats.stage4_collapsed = collapsed_count;

    // If still over max_messages, collapse middle messages into summary
    if collapsed.len() > max_messages {
        return collapse_to_summary(collapsed, max_messages, stats);
    }

    collapsed
}

/// Collapse middle messages into a summary message
fn collapse_to_summary(
    messages: Vec<PipelineMessage>,
    max_messages: usize,
    _stats: &mut PipelineStats,
) -> Vec<PipelineMessage> {
    // Keep system messages
    let system_msgs: Vec<_> = messages
        .iter()
        .filter(|m| m.role == "system")
        .cloned()
        .collect();

    // Keep recent messages
    let recent_count = max_messages.saturating_sub(system_msgs.len()).saturating_sub(1);
    let recent_msgs: Vec<_> = messages.iter().rev().take(recent_count).rev().cloned().collect();

    // Calculate middle range
    let middle_start = system_msgs.len();
    let middle_end = messages.len() - recent_msgs.len();

    if middle_start < middle_end {
        let middle_count = middle_end - middle_start;
        let summary = PipelineMessage {
            role: "system".to_string(),
            content: format!("[{} earlier messages collapsed]", middle_count),
            tool_calls: None,
            tool_call_id: None,
            metadata: Some(
                serde_json::json!({
                    "_pipeline": "collapsed",
                    "_collapsedCount": middle_count
                })
                .to_string(),
            ),
        };

        let mut result = system_msgs;
        result.push(summary);
        result.extend(recent_msgs);
        result
    } else {
        messages
    }
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
    fn test_no_collapse_under_limit() {
        let messages = vec![
            create_message("user", "Hello"),
            create_message("assistant", "Hi"),
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

        let result = collapse_messages(messages, 10, &mut stats);
        assert_eq!(result.len(), 2);
        assert_eq!(stats.stage4_collapsed, 0);
    }

    #[test]
    fn test_collapse_consecutive_same_role() {
        let messages = vec![
            create_message("user", "Hello"),
            create_message("user", "World"),
            create_message("assistant", "Hi there"),
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

        let result = collapse_messages(messages, 10, &mut stats);
        assert_eq!(result.len(), 2);
        assert_eq!(stats.stage4_collapsed, 1);
        assert!(result[0].content.contains("Hello"));
        assert!(result[0].content.contains("World"));
    }

    #[test]
    fn test_collapse_to_summary() {
        let messages: Vec<_> = (0..20)
            .map(|i| create_message("user", &format!("Message {}", i)))
            .collect();
        let mut stats = PipelineStats {
            stage1_tool_results: 0,
            stage2_snipped: 0,
            stage3_normalized: 0,
            stage4_collapsed: 0,
            stage5_compacted: 0,
            total_tokens_before: 0,
            total_tokens_after: 0,
        };

        let result = collapse_messages(messages, 5, &mut stats);
        assert!(result.len() <= 5);
        assert!(result.iter().any(|m| m.content.contains("collapsed")));
    }
}

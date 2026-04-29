//! Context Pipeline - 5-stage preprocessing

use crate::{PipelineConfig, PipelineMessage, PipelineResponse, PipelineStats, ToolCall};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Run the full 5-stage context pipeline
pub fn run_pipeline(
    messages: Vec<PipelineMessage>,
    config: PipelineConfig,
) -> Result<PipelineResponse> {
    let max_tool_result_tokens = config.max_tool_result_tokens.unwrap_or(8000) as usize;
    let snip_threshold = config.snip_threshold.unwrap_or(4000) as usize;
    let max_messages = config.max_messages.unwrap_or(50) as usize;
    let compact_threshold = config.compact_threshold.unwrap_or(0.8);
    let context_window = config.context_window.unwrap_or(128000) as usize;

    let mut stats = PipelineStats {
        stage1_tool_results: 0,
        stage2_snipped: 0,
        stage3_normalized: 0,
        stage4_collapsed: 0,
        stage5_compacted: 0,
        total_tokens_before: 0,
        total_tokens_after: 0,
    };

    // Calculate initial token count
    stats.total_tokens_before = estimate_tokens(&messages) as u32;

    let mut result = messages;

    // Stage 1: Apply tool result budget
    result = super::budget::apply_tool_budget(result, max_tool_result_tokens, &mut stats);

    // Stage 2: Snip long messages
    result = super::snip::snip_messages(result, snip_threshold, &mut stats);

    // Stage 3: Normalize messages
    result = super::normalize::normalize_messages(result, &mut stats);

    // Stage 4: Collapse consecutive same-role messages
    result = super::collapse::collapse_messages(result, max_messages, &mut stats);

    // Stage 5: Auto-compact if over threshold
    result = super::compact::auto_compact(result, context_window, compact_threshold, &mut stats);

    // Calculate final token count
    stats.total_tokens_after = estimate_tokens(&result) as u32;

    Ok(PipelineResponse {
        messages: result,
        stats,
    })
}

/// JavaScript-facing pipeline function
#[napi(js_name = "runPipeline")]
pub fn run_pipeline_js(
    messages: Vec<PipelineMessage>,
    config: Option<PipelineConfig>,
) -> Result<PipelineResponse> {
    run_pipeline(messages, config.unwrap_or_default())
}

/// Estimate token count for messages (rough estimate)
fn estimate_tokens(messages: &[PipelineMessage]) -> usize {
    let mut total = 0;
    for msg in messages {
        // Rough estimate: 1 token ≈ 4 chars for English text
        total += (msg.content.len() + 3) / 4;
        // Add overhead per message
        total += 4;
        // Add tool calls if present
        if let Some(ref tool_calls) = msg.tool_calls {
            for tc in tool_calls {
                total += (tc.name.len() + 3) / 4;
                total += (tc.params.len() + 3) / 4;
            }
        }
    }
    total
}

/// Count tokens accurately using tiktoken
pub fn count_tokens_accurate(messages: &[PipelineMessage], model: &str) -> Result<usize> {
    use crate::tokenizer;
    
    let mut total = 0;
    for msg in messages {
        total += tokenizer::count_message_tokens(&msg.role, &msg.content, model)?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message(role: &str, content: &str) -> PipelineMessage {
        PipelineMessage {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            metadata: None,
        }
    }

    #[test]
    fn test_empty_pipeline() {
        let messages = vec![];
        let config = PipelineConfig::default();
        let result = run_pipeline(messages, config).unwrap();
        assert_eq!(result.messages.len(), 0);
    }

    #[test]
    fn test_single_message() {
        let messages = vec![create_test_message("user", "Hello world")];
        let config = PipelineConfig::default();
        let result = run_pipeline(messages, config).unwrap();
        assert_eq!(result.messages.len(), 1);
    }
}

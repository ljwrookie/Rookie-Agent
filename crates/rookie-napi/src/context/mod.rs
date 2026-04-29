//! Context Pipeline Module
//!
//! 5-stage context preprocessing pipeline:
//! 1. Tool Budget - Apply tool result budget
//! 2. Snip - Truncate long messages intelligently
//! 3. Normalize - Message format normalization
//! 4. Collapse - Merge consecutive same-role messages
//! 5. Compact - Auto-compact when over threshold

pub mod budget;
pub mod collapse;
pub mod compact;
pub mod normalize;
pub mod pipeline;
pub mod snip;

pub mod tantivy;
pub mod walker;
pub mod watcher;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Shared FileInfo type used across walker and tantivy modules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: PathBuf,
    pub size: u64,
    pub is_dir: bool,
}

pub use tantivy::FileIndex;
pub use watcher::{IndexWatcher, IncrementalIndexer, FileEvent, FileEventKind};

use std::path::Path;

use ignore::WalkBuilder;
use super::FileInfo;

pub fn walk_project(root: &Path) -> impl Iterator<Item = FileInfo> + '_ {
    WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let metadata = entry.metadata().ok()?;

            Some(FileInfo {
                path: path.to_path_buf(),
                size: metadata.len(),
                is_dir: metadata.is_dir(),
            })
        })
}

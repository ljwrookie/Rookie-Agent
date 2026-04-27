use std::path::{Path, PathBuf};
use std::sync::Arc;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

pub struct IndexWatcher {
    watcher: RecommendedWatcher,
    rx: mpsc::Receiver<FileEvent>,
}

#[derive(Debug, Clone)]
pub struct FileEvent {
    pub kind: FileEventKind,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub enum FileEventKind {
    Created,
    Modified,
    Deleted,
    Renamed,
}

impl IndexWatcher {
    pub fn new() -> anyhow::Result<Self> {
        let (tx, rx) = mpsc::channel(100);

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let kind = match event.kind {
                        notify::EventKind::Create(_) => FileEventKind::Created,
                        notify::EventKind::Modify(_) => FileEventKind::Modified,
                        notify::EventKind::Remove(_) => FileEventKind::Deleted,
                        _ => return,
                    };

                    for path in event.paths {
                        let _ = tx.try_send(FileEvent { kind: kind.clone(), path });
                    }
                }
            },
            Config::default(),
        )?;

        Ok(Self { watcher, rx })
    }

    pub fn watch(&mut self, path: &Path) -> anyhow::Result<()> {
        self.watcher.watch(path, RecursiveMode::Recursive)?;
        Ok(())
    }

    pub fn unwatch(&mut self, path: &Path) -> anyhow::Result<()> {
        self.watcher.unwatch(path)?;
        Ok(())
    }

    pub async fn next_event(&mut self) -> Option<FileEvent> {
        self.rx.recv().await
    }
}

pub struct IncrementalIndexer {
    watcher: IndexWatcher,
    pending_updates: Vec<FileEvent>,
}

impl IncrementalIndexer {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            watcher: IndexWatcher::new()?,
            pending_updates: Vec::new(),
        })
    }

    pub fn watch(&mut self, path: &Path) -> anyhow::Result<()> {
        self.watcher.watch(path)
    }

    pub async fn run<F>(&mut self, mut on_update: F) -> anyhow::Result<()>
    where
        F: FnMut(&[FileEvent]),
    {
        let mut batch_timer = tokio::time::interval(tokio::time::Duration::from_secs(2));

        loop {
            tokio::select! {
                Some(event) = self.watcher.next_event() => {
                    self.pending_updates.push(event);
                }
                _ = batch_timer.tick() => {
                    if !self.pending_updates.is_empty() {
                        let updates = std::mem::take(&mut self.pending_updates);
                        on_update(&updates);
                    }
                }
            }
        }
    }
}

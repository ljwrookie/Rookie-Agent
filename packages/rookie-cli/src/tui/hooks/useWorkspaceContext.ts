// ─── Workspace Context State Hook ────────────────────────────────
// Extracted from useTuiState god hook. Manages files, tasks, git info.

import { useState, useCallback } from "react";
import type { WorkspaceContext, LongTask } from "../types.js";

const initialContext: WorkspaceContext = {
  directory: process.cwd(),
  gitBranch: undefined,
  gitDirty: false,
  recentFiles: [],
  activeFiles: [],
  taskCount: { total: 0, done: 0, pending: 0 },
};

export function useWorkspaceContext(meta: { directory: string; branch?: string }) {
  const [context, setContext] = useState<WorkspaceContext>({
    ...initialContext,
    directory: meta.directory,
    gitBranch: meta.branch,
  });
  const [longTasks, setLongTasks] = useState<LongTask[]>([]);

  const addActiveFile = useCallback((path: string) => {
    setContext(prev => ({
      ...prev,
      activeFiles: prev.activeFiles.includes(path)
        ? prev.activeFiles
        : [...prev.activeFiles, path],
    }));
  }, []);

  const addRecentFile = useCallback((path: string) => {
    setContext(prev => ({
      ...prev,
      recentFiles: prev.recentFiles.includes(path)
        ? prev.recentFiles
        : [...prev.recentFiles.slice(-19), path],
    }));
  }, []);

  const startLongTask = useCallback((name: string, phase: string): string => {
    const id = `task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    setLongTasks(prev => [...prev, {
      id, name, phase, status: "running", startedAt: Date.now(),
    }]);
    return id;
  }, []);

  const updateLongTask = useCallback((id: string, patch: Partial<LongTask>) => {
    setLongTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const updateTaskProgress = useCallback((id: string, progress: number, output?: string) => {
    setLongTasks(prev => prev.map(t =>
      t.id === id ? { ...t, progress: Math.max(0, Math.min(1, progress)), output: output ?? t.output } : t
    ));
  }, []);

  const setTaskCount = useCallback((next: WorkspaceContext["taskCount"]) => {
    setContext(prev => ({
      ...prev,
      taskCount: {
        total: Math.max(0, Number(next.total) || 0),
        done: Math.max(0, Number(next.done) || 0),
        pending: Math.max(0, Number(next.pending) || 0),
      },
    }));
  }, []);

  return {
    context,
    longTasks,
    addActiveFile,
    addRecentFile,
    startLongTask,
    updateLongTask,
    updateTaskProgress,
    setTaskCount,
  };
}

export type WorkspaceContextAPI = ReturnType<typeof useWorkspaceContext>;

// Scheduler types for cron/loop tasks

export type ScheduleInterval =
  | { type: "minutes"; value: number }
  | { type: "hours"; value: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "cron"; expression: string };

export interface ScheduledTask {
  id: string;
  name: string;
  command: string;
  interval: ScheduleInterval;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  loop?: boolean; // if true, re-schedules after completion
}

export interface SchedulerStore {
  version: 1;
  tasks: ScheduledTask[];
}

export interface SchedulerOptions {
  projectRoot: string;
  storePath?: string;
  onExecute?: (task: ScheduledTask) => Promise<string>;
  now?: () => number;
}

export type SchedulerEvent =
  | { type: "task_started"; taskId: string; timestamp: number }
  | { type: "task_completed"; taskId: string; output: string; duration: number }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "task_scheduled"; task: ScheduledTask }
  | { type: "task_cancelled"; taskId: string };

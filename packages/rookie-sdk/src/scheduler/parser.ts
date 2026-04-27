// Parse interval expressions: 5m, 1h, @daily, cron(0 9 * * *)

import type { ScheduleInterval } from "./types.js";

export type { ScheduleInterval };

export function parseInterval(expr: string): ScheduleInterval | null {
  const trimmed = expr.trim();

  // Minutes: 5m, 30min, etc.
  const minutesMatch = /^(\d+)\s*m(in)?$/i.exec(trimmed);
  if (minutesMatch) {
    const value = parseInt(minutesMatch[1], 10);
    if (value > 0 && value <= 1440) {
      return { type: "minutes", value };
    }
    return null;
  }

  // Hours: 1h, 2hr, 12hours, etc.
  const hoursMatch = /^(\d+)\s*h(r|our|ours)?$/i.exec(trimmed);
  if (hoursMatch) {
    const value = parseInt(hoursMatch[1], 10);
    if (value > 0 && value <= 168) {
      return { type: "hours", value };
    }
    return null;
  }

  // Daily: @daily or @9:00 or @09:30
  if (trimmed === "@daily") {
    return { type: "daily", hour: 9, minute: 0 }; // default 9am
  }
  const dailyMatch = /^@(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1], 10);
    const minute = parseInt(dailyMatch[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { type: "daily", hour, minute };
    }
    return null;
  }

  // Cron: cron(0 9 * * *)
  const cronMatch = /^cron\((.+)\)$/i.exec(trimmed);
  if (cronMatch) {
    const expression = cronMatch[1].trim();
    // Basic validation: should have 5 parts
    const parts = expression.split(/\s+/);
    if (parts.length === 5) {
      return { type: "cron", expression };
    }
    return null;
  }

  return null;
}

export function intervalToCron(interval: ScheduleInterval): string {
  switch (interval.type) {
    case "minutes":
      return `*/${interval.value} * * * *`;
    case "hours":
      return `0 */${interval.value} * * *`;
    case "daily":
      return `${interval.minute} ${interval.hour} * * *`;
    case "cron":
      return interval.expression;
    default:
      return "0 9 * * *"; // fallback to 9am daily
  }
}

export function intervalToString(interval: ScheduleInterval): string {
  switch (interval.type) {
    case "minutes":
      return `${interval.value}m`;
    case "hours":
      return `${interval.value}h`;
    case "daily":
      return `@${String(interval.hour).padStart(2, "0")}:${String(interval.minute).padStart(2, "0")}`;
    case "cron":
      return `cron(${interval.expression})`;
    default:
      return "unknown";
  }
}

export function getNextRunTime(interval: ScheduleInterval, from: number = Date.now()): number {
  const date = new Date(from);

  switch (interval.type) {
    case "minutes":
      return from + interval.value * 60 * 1000;
    case "hours":
      return from + interval.value * 60 * 60 * 1000;
    case "daily": {
      const target = new Date(date);
      target.setHours(interval.hour, interval.minute, 0, 0);
      if (target.getTime() <= from) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }
    case "cron":
      // For cron, we'd need a full cron parser; approximate for now
      return from + 60 * 60 * 1000; // default 1 hour
    default:
      return from + 24 * 60 * 60 * 1000;
  }
}

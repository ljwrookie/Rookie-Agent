# Scheduler

Run commands on a schedule with built-in cron support.

## Commands

```bash
# Schedule a one-time verification
rookie /schedule 10m /verify

# Create a daily loop
rookie /loop @daily /verify

# List scheduled tasks
rookie /schedule

# Cancel a task
rookie /unschedule <id>
```

## Interval Formats

| Format | Example |
|--------|---------|
| Minutes | `5m`, `30min` |
| Hours | `1h`, `2hr` |
| Daily | `@daily`, `@14:30` |
| Cron | `cron(0 9 * * *)` |

## Persistence

Tasks are saved to `.rookie/schedulers.json` and restored on startup.

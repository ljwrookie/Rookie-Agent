import { useState } from "react";
import { useLogs } from "../hooks/useApi";
import { useWebSocket } from "../hooks/useWebSocket";
import { ScrollText, Filter, AlertCircle, Info, AlertTriangle, Bug } from "lucide-react";
import { cn } from "../utils/cn";
import { format } from "date-fns";
import type { LogEntry, LogFilter } from "../types";

const logLevels = ["debug", "info", "warn", "error"] as const;

const levelIcons = {
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const levelColors = {
  debug: "text-gray-500 bg-gray-100",
  info: "text-blue-500 bg-blue-100",
  warn: "text-yellow-500 bg-yellow-100",
  error: "text-red-500 bg-red-100",
};

export function Logs() {
  const [filter, setFilter] = useState<LogFilter>({});
  const { data: logs, isLoading } = useLogs(filter);
  const [newLogs, setNewLogs] = useState<LogEntry[]>([]);

  // Real-time log updates
  useWebSocket("ws://localhost:8080/ws", {
    onLogEntry: (entry) => {
      setNewLogs((prev) => [entry, ...prev].slice(0, 100));
    },
  });

  const allLogs = [...newLogs, ...(logs ?? [])];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">System Logs</h1>
        <p className="text-muted-foreground">View and filter system logs</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4" />
          <span className="font-medium">Filters</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={filter.level || ""}
            onChange={(e) => setFilter({ ...filter, level: e.target.value || undefined })}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="">All Levels</option>
            {logLevels.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Source..."
            value={filter.source || ""}
            onChange={(e) => setFilter({ ...filter, source: e.target.value || undefined })}
            className="px-3 py-2 border rounded-md bg-background"
          />

          <input
            type="text"
            placeholder="Search..."
            value={filter.search || ""}
            onChange={(e) => setFilter({ ...filter, search: e.target.value || undefined })}
            className="px-3 py-2 border rounded-md bg-background"
          />

          <button
            onClick={() => setFilter({})}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log List */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4" />
            Log Entries
          </h3>
          <span className="text-sm text-muted-foreground">
            {allLogs.length} entries
          </span>
        </div>

        <div className="divide-y max-h-[600px] overflow-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : allLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No logs found
            </div>
          ) : (
            allLogs.map((log) => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </div>
    </div>
  );
}

interface LogRowProps {
  log: LogEntry;
}

function LogRow({ log }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = levelIcons[log.level];

  return (
    <div
      className={cn(
        "p-4 hover:bg-accent/50 cursor-pointer transition-colors",
        expanded && "bg-accent/50"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-1 rounded", levelColors[log.level])}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground">
              {format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss.SSS")}
            </span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                levelColors[log.level]
              )}
            >
              {log.level.toUpperCase()}
            </span>
            <span className="text-xs text-muted-foreground">[{log.source}]</span>
          </div>
          <p className="text-sm mt-1">{log.message}</p>

          {expanded && log.metadata && (
            <div className="mt-3 p-3 bg-secondary rounded-md">
              <pre className="text-xs overflow-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

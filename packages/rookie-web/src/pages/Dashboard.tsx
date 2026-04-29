import { useSystemStats } from "../hooks/useApi";
import {
  MessageSquare,
  Brain,
  Wrench,
  Cpu,
  Activity,
  TrendingUp,
  Clock,
} from "lucide-react";
import { cn } from "../utils/cn";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
}

function StatCard({ title, value, description, icon: Icon, trend, trendLabel }: StatCardProps) {
  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h3 className="text-2xl font-bold mt-1">{value}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {trend !== undefined && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-xs",
              trend >= 0 ? "text-green-500" : "text-red-500"
            )}>
              <TrendingUp className="w-3 h-3" />
              <span>{trend >= 0 ? "+" : ""}{trend}% {trendLabel}</span>
            </div>
          )}
        </div>
        <div className="p-3 bg-primary/10 rounded-full">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: stats, isLoading } = useSystemStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your Rookie Agent instance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Conversations"
          value={stats?.activeConversations ?? 0}
          description="Currently active sessions"
          icon={MessageSquare}
          trend={12}
          trendLabel="vs last hour"
        />
        <StatCard
          title="Total Messages"
          value={stats?.totalMessages?.toLocaleString() ?? 0}
          description="Messages processed today"
          icon={Brain}
          trend={8}
          trendLabel="vs yesterday"
        />
        <StatCard
          title="Active Skills"
          value={12}
          description="Skills currently loaded"
          icon={Wrench}
        />
        <StatCard
          title="Model Health"
          value="Healthy"
          description="All models operational"
          icon={Cpu}
        />
      </div>

      {/* System Resources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5" />
            System Resources
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Memory Usage</span>
                <span>{stats?.memory.percentage.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    stats && stats.memory.percentage > 80 ? "bg-red-500" : "bg-primary"
                  )}
                  style={{ width: `${stats?.memory.percentage ?? 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {(stats?.memory.used ?? 0).toFixed(1)} MB / {(stats?.memory.total ?? 0).toFixed(1)} MB
              </p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>CPU Usage</span>
                <span>{stats?.cpu.usage.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    stats && stats.cpu.usage > 80 ? "bg-red-500" : "bg-primary"
                  )}
                  style={{ width: `${stats?.cpu.usage ?? 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.cpu.cores ?? 0} cores
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            System Status
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Uptime</span>
              <span className="font-mono text-sm">
                {formatUptime(stats?.uptime ?? 0)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">Pending Tasks</span>
              <span className="font-mono text-sm">{stats?.pendingTasks ?? 0}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm">WebSocket Status</span>
              <span className="text-green-500 text-sm flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Connected
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm">Version</span>
              <span className="font-mono text-sm">v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

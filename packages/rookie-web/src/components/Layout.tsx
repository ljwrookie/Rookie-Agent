import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Brain,
  Wrench,
  Cpu,
  Network,
  ScrollText,
  Settings,
  Activity,
} from "lucide-react";
import { cn } from "../utils/cn";
import { useWebSocket } from "../hooks/useWebSocket";
import { useState } from "react";
import type { SystemStats } from "../types";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/conversations", label: "Conversations", icon: MessageSquare },
  { path: "/memory", label: "Memory", icon: Brain },
  { path: "/skills", label: "Skills", icon: Wrench },
  { path: "/models", label: "Models", icon: Cpu },
  { path: "/gateway", label: "Gateway", icon: Network },
  { path: "/logs", label: "Logs", icon: ScrollText },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  const { connected } = useWebSocket("ws://localhost:8080/ws", {
    onStats: setStats,
  });

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Activity className={cn("w-6 h-6", connected ? "text-green-500" : "text-red-500")} />
            Rookie Agent
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* System Stats */}
        {stats && (
          <div className="p-4 border-t space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Memory</span>
              <span>{stats.memory.percentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${stats.memory.percentage}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">CPU</span>
              <span>{stats.cpu.usage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${stats.cpu.usage}%` }}
              />
            </div>
            <div className="pt-2 text-muted-foreground">
              {stats.activeConversations} active conversations
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

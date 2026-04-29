import { useGatewayStatus } from "../hooks/useApi";
import { useWebSocket } from "../hooks/useWebSocket";
import { Network, Check, X, AlertCircle, MessageSquare } from "lucide-react";
import { cn } from "../utils/cn";
import type { GatewayStatus } from "../types";

export function Gateway() {
  const { data: gateways, isLoading } = useGatewayStatus();

  // Real-time updates
  useWebSocket("ws://localhost:8080/ws", {
    onGatewayUpdate: (status) => {
      console.log("Gateway updated:", status);
    },
  });

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const connected = gateways?.filter((g) => g.status === "connected") ?? [];
  const disconnected = gateways?.filter((g) => g.status !== "connected") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gateway Status</h1>
        <p className="text-muted-foreground">Monitor gateway connections</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          title="Connected"
          value={connected.length}
          icon={Check}
          color="green"
        />
        <SummaryCard
          title="Disconnected"
          value={disconnected.length}
          icon={X}
          color="gray"
        />
        <SummaryCard
          title="Total Messages"
          value={gateways?.reduce((sum, g) => sum + g.messageCount, 0) ?? 0}
          icon={MessageSquare}
          color="blue"
        />
      </div>

      {/* Gateway List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {gateways?.map((gateway) => (
          <GatewayCard key={gateway.id} gateway={gateway} />
        ))}
        {gateways?.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No gateways configured</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  color: "green" | "gray" | "blue" | "red";
}

function SummaryCard({ title, value, icon: Icon, color }: SummaryCardProps) {
  const colors = {
    green: "bg-green-100 text-green-700",
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    red: "bg-red-100 text-red-700",
  };

  return (
    <div className="bg-card rounded-lg border p-4 flex items-center gap-4">
      <div className={cn("p-3 rounded-lg", colors[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

interface GatewayCardProps {
  gateway: GatewayStatus;
}

function GatewayCard({ gateway }: GatewayCardProps) {
  const isConnected = gateway.status === "connected";

  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg",
              isConnected ? "bg-green-100" : "bg-red-100"
            )}
          >
            <Network
              className={cn(
                "w-5 h-5",
                isConnected ? "text-green-600" : "text-red-600"
              )}
            />
          </div>
          <div>
            <h3 className="font-semibold">{gateway.name}</h3>
            <p className="text-sm text-muted-foreground">{gateway.type}</p>
          </div>
        </div>
        <span
          className={cn(
            "text-xs px-2 py-1 rounded-full font-medium",
            isConnected
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          )}
        >
          {gateway.status}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Messages</span>
          <span className="font-medium">{gateway.messageCount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Errors</span>
          <span
            className={cn(
              "font-medium",
              gateway.errorCount > 0 ? "text-red-500" : ""
            )}
          >
            {gateway.errorCount}
          </span>
        </div>
        {gateway.connectedSince && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Connected Since</span>
            <span className="font-medium">
              {new Date(gateway.connectedSince).toLocaleString()}
            </span>
          </div>
        )}
        {gateway.lastActivity && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last Activity</span>
            <span className="font-medium">
              {new Date(gateway.lastActivity).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {gateway.errorCount > 0 && (
        <div className="mt-4 p-3 bg-red-50 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
          <p className="text-sm text-red-700">
            This gateway has encountered errors. Check the logs for details.
          </p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import type { WebSocketMessage, SystemStats, Conversation, Message, LogEntry, GatewayStatus } from "../types";

interface WebSocketState {
  connected: boolean;
  error: string | null;
}

interface UseWebSocketOptions {
  onStats?: (stats: SystemStats) => void;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewMessage?: (message: Message) => void;
  onLogEntry?: (entry: LogEntry) => void;
  onGatewayUpdate?: (status: GatewayStatus) => void;
  reconnectInterval?: number;
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref up to date
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setState({ connected: true, error: null });
        console.log("WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setState((prev) => ({ ...prev, error: "Connection error" }));
      };

      ws.onclose = () => {
        setState({ connected: false, error: "Disconnected" });
        console.log("WebSocket disconnected");

        // Reconnect after delay
        const reconnectInterval = optionsRef.current.reconnectInterval ?? 5000;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      };

      wsRef.current = ws;
    } catch (err) {
      setState({ connected: false, error: "Failed to connect" });
    }
  }, [url]);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    const opts = optionsRef.current;

    switch (message.type) {
      case "pong":
        // Heartbeat response
        break;
      case "stats":
        opts.onStats?.(message.data);
        break;
      case "conversation_update":
        opts.onConversationUpdate?.(message.data);
        break;
      case "new_message":
        opts.onNewMessage?.(message.data);
        break;
      case "log_entry":
        opts.onLogEntry?.(message.data);
        break;
      case "gateway_update":
        opts.onGatewayUpdate?.(message.data);
        break;
      case "error":
        console.error("Server error:", message.message);
        break;
    }
  }, []);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const ping = useCallback(() => {
    send({ type: "ping" });
  }, [send]);

  useEffect(() => {
    connect();

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      ping();
    }, 30000);

    return () => {
      clearInterval(heartbeatInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect, ping]);

  return {
    ...state,
    send,
    ping,
  };
}

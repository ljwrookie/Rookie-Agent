// ─── Agents Domain Hook ──────────────────────────────────────────
// Multi-agent status and mailbox

import { useState, useCallback } from "react";
import type { AgentStatus, MailboxMessage } from "../types.js";

export function useAgents() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [mailbox, setMailbox] = useState<MailboxMessage[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);

  const eventIdCounter = { current: 0 };
  const genId = useCallback((prefix: string) => {
    eventIdCounter.current += 1;
    return `${prefix}_${Date.now()}_${eventIdCounter.current}`;
  }, []);

  const updateAgent = useCallback((agentId: string, patch: Partial<AgentStatus>) => {
    setAgents(prev => {
      const existing = prev.find(a => a.id === agentId);
      if (existing) {
        return prev.map(a => a.id === agentId ? { ...a, ...patch } : a);
      }
      return [...prev, { id: agentId, name: agentId, state: "idle", taskSummary: "", tokensUsed: 0, toolCalls: 0, ...patch }];
    });
  }, []);

  const removeAgent = useCallback((agentId: string) => {
    setAgents(prev => prev.filter(a => a.id !== agentId));
  }, []);

  const addMailboxMessage = useCallback((msg: Omit<MailboxMessage, "id" | "timestamp">) => {
    const id = genId("msg");
    setMailbox(prev => [...prev, { ...msg, id, timestamp: Date.now() }]);
  }, [genId]);

  const clearAgents = useCallback(() => {
    setAgents([]);
    setMailbox([]);
    setSelectedAgentId(undefined);
  }, []);

  return {
    agents,
    mailbox,
    selectedAgentId,
    updateAgent,
    removeAgent,
    addMailboxMessage,
    clearAgents,
    setSelectedAgentId,
  };
}

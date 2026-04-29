/**
 * AgentPanel: Multi-agent visualization component (D8)
 *
 * Displays:
 * - Table of all active agents with status, tokens, tool calls
 * - Mailbox showing inter-agent messages
 * - Progress indicators for running agents
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentStatus, MailboxMessage, TuiMode } from "../types.js";

interface AgentPanelProps {
  agents: AgentStatus[];
  mailbox: MailboxMessage[];
  selectedAgentId?: string;
  mode: TuiMode;
  onSelectAgent: (id: string) => void;
  onChangeMode: (mode: TuiMode) => void;
}

const STATE_ICONS: Record<AgentStatus["state"], string> = {
  idle: "⏳",
  running: "🔄",
  done: "✅",
  error: "❌",
};

const STATE_COLORS: Record<AgentStatus["state"], string> = {
  idle: "yellow",
  running: "cyan",
  done: "green",
  error: "red",
};

export const AgentPanel: React.FC<AgentPanelProps> = ({
  agents,
  mailbox,
  selectedAgentId,
  mode,
  onSelectAgent,
  onChangeMode,
}) => {
  // Keyboard handling
  useInput((input, key) => {
    if (mode !== "agents") return;

    if (key.upArrow || input === "k") {
      const idx = agents.findIndex((a) => a.id === selectedAgentId);
      const newIdx = idx <= 0 ? agents.length - 1 : idx - 1;
      onSelectAgent(agents[newIdx]?.id);
    } else if (key.downArrow || input === "j") {
      const idx = agents.findIndex((a) => a.id === selectedAgentId);
      const newIdx = idx >= agents.length - 1 ? 0 : idx + 1;
      onSelectAgent(agents[newIdx]?.id);
    } else if (key.escape || input === "q") {
      onChangeMode("chat");
    }
  });

  // Calculate totals
  const totals = useMemo(() => {
    return agents.reduce(
      (acc, agent) => ({
        tokens: acc.tokens + agent.tokensUsed,
        tools: acc.tools + agent.toolCalls,
        running: acc.running + (agent.state === "running" ? 1 : 0),
      }),
      { tokens: 0, tools: 0, running: 0 }
    );
  }, [agents]);

  // Filter mailbox for selected agent
  const relevantMessages = useMemo(() => {
    if (!selectedAgentId) return mailbox.slice(-20);
    return mailbox
      .filter((m) => m.from === selectedAgentId || m.to === selectedAgentId || m.type === "broadcast")
      .slice(-20);
  }, [mailbox, selectedAgentId]);

  if (agents.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          🤖 Agent Panel
        </Text>
        <Box marginTop={1}>
          <Text color="gray">No active agents. Start a multi-agent task to see agents here.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Esc or q to return to chat</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} height="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🤖 Agent Panel
        </Text>
        <Text> · </Text>
        <Text>{agents.length} agents</Text>
        <Text> · </Text>
        <Text color="green">{totals.running} running</Text>
        <Text> · </Text>
        <Text color="yellow">{totals.tokens.toLocaleString()} tokens</Text>
        <Text> · </Text>
        <Text color="magenta">{totals.tools} tools</Text>
      </Box>

      <Box flexDirection="row" height="100%">
        {/* Agent Table */}
        <Box flexDirection="column" width="60%" paddingRight={1}>
          {/* Table Header */}
          <Box flexDirection="row" borderStyle="single" paddingX={1}>
            <Box width={3}>
              <Text bold>#</Text>
            </Box>
            <Box width={15}>
              <Text bold>Name</Text>
            </Box>
            <Box width={10}>
              <Text bold>Status</Text>
            </Box>
            <Box width={12}>
              <Text bold>Tokens</Text>
            </Box>
            <Box width={10}>
              <Text bold>Tools</Text>
            </Box>
            <Box width={20}>
              <Text bold>Task</Text>
            </Box>
          </Box>

          {/* Table Body */}
          {agents.map((agent, idx) => (
            <Box
              key={agent.id}
              flexDirection="row"
              paddingX={1}
              backgroundColor={agent.id === selectedAgentId ? "gray" : undefined}
            >
              <Box width={3}>
                <Text>{idx + 1}</Text>
              </Box>
              <Box width={15}>
                <Text bold>{agent.name}</Text>
              </Box>
              <Box width={10}>
                <Text color={STATE_COLORS[agent.state]}>
                  {STATE_ICONS[agent.state]} {agent.state}
                </Text>
              </Box>
              <Box width={12}>
                <Text>{agent.tokensUsed.toLocaleString()}</Text>
              </Box>
              <Box width={10}>
                <Text>{agent.toolCalls}</Text>
              </Box>
              <Box width={20}>
                <Text color="gray" wrap="truncate-end">
                  {agent.taskSummary.slice(0, 20)}
                </Text>
              </Box>
            </Box>
          ))}

          {/* Progress bars for running agents */}
          <Box flexDirection="column" marginTop={1}>
            {agents
              .filter((a) => a.state === "running" && a.progress !== undefined)
              .map((agent) => (
                <Box key={agent.id} flexDirection="column" marginY={1}>
                  <Text dimColor>
                    {agent.name}: {Math.round((agent.progress || 0) * 100)}%
                  </Text>
                  <Box>
                    <Text color="cyan">{"█".repeat(Math.round((agent.progress || 0) * 20))}</Text>
                    <Text color="gray">{"░".repeat(20 - Math.round((agent.progress || 0) * 20))}</Text>
                  </Box>
                </Box>
              ))}
          </Box>
        </Box>

        {/* Mailbox */}
        <Box flexDirection="column" width="40%" borderStyle="single" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              📬 Mailbox
              {selectedAgentId && ` (${agents.find((a) => a.id === selectedAgentId)?.name || selectedAgentId})`}
            </Text>
          </Box>

          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {relevantMessages.length === 0 ? (
              <Text color="gray">No messages yet</Text>
            ) : (
              relevantMessages.map((msg) => (
                <Box key={msg.id} flexDirection="column" marginY={1}>
                  <Box>
                    <Text dimColor>{new Date(msg.timestamp).toLocaleTimeString()}</Text>
                    <Text> · </Text>
                    <Text color="yellow">{msg.from}</Text>
                    <Text> → </Text>
                    <Text color="green">{msg.to || "*"}</Text>
                    <Text> · </Text>
                    <Text color="gray">[{msg.type}]</Text>
                  </Box>
                  <Text wrap="truncate-end" color="gray">
                    {msg.content.slice(0, 100)}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          ↑/↓ or j/k: select · Enter: details · Esc/q: back to chat
        </Text>
      </Box>
    </Box>
  );
};

export default AgentPanel;

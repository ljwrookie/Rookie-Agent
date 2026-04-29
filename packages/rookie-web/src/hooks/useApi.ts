import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Conversation,
  Message,
  MemoryEntry,
  Skill,
  ModelConfig,
  ModelHealth,
  GatewayStatus,
  LogEntry,
  LogFilter,
  SystemStats,
} from "../types";

const API_BASE = "/api";

// Fetch helpers
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Conversations
export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchJson<Conversation[]>("/conversations"),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conversations", id],
    queryFn: () => fetchJson<Conversation>(`/conversations/${id}`),
    enabled: !!id,
  });
}

export function useConversationMessages(id: string) {
  return useQuery({
    queryKey: ["conversations", id, "messages"],
    queryFn: () => fetchJson<Message[]>(`/conversations/${id}/messages`),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title: string }) =>
      fetchJson<Conversation>("/conversations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<void>(`/conversations/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

// Memory
export function useMemoryEntries(query?: string) {
  return useQuery({
    queryKey: ["memory", query],
    queryFn: () =>
      fetchJson<MemoryEntry[]>(`/memory${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  });
}

export function useSearchMemory() {
  return useMutation({
    mutationFn: (query: string) =>
      fetchJson<MemoryEntry[]>("/memory/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      }),
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<void>(`/memory/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

// Skills
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => fetchJson<Skill[]>("/skills"),
  });
}

export function useToggleSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetchJson<Skill>(`/skills/${id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

// Models
export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => fetchJson<ModelConfig[]>("/models"),
  });
}

export function useModelHealth() {
  return useQuery({
    queryKey: ["models", "health"],
    queryFn: () => fetchJson<ModelHealth[]>("/models/health"),
    refetchInterval: 30000, // Refetch every 30s
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: ModelConfig) =>
      fetchJson<ModelConfig>(`/models/${model.id}`, {
        method: "PUT",
        body: JSON.stringify(model),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

// Gateway
export function useGatewayStatus() {
  return useQuery({
    queryKey: ["gateway"],
    queryFn: () => fetchJson<GatewayStatus[]>("/gateway"),
    refetchInterval: 10000, // Refetch every 10s
  });
}

// Logs
export function useLogs(filter?: LogFilter) {
  const params = new URLSearchParams();
  if (filter?.level) params.append("level", filter.level);
  if (filter?.source) params.append("source", filter.source);
  if (filter?.startTime) params.append("startTime", filter.startTime);
  if (filter?.endTime) params.append("endTime", filter.endTime);
  if (filter?.search) params.append("search", filter.search);

  return useQuery({
    queryKey: ["logs", filter],
    queryFn: () => fetchJson<LogEntry[]>(`/logs?${params.toString()}`),
  });
}

// Stats
export function useSystemStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchJson<SystemStats>("/stats"),
    refetchInterval: 5000, // Refetch every 5s
  });
}

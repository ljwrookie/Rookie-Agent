import { useState } from "react";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "../hooks/useApi";
import { useWebSocket } from "../hooks/useWebSocket";
import { Plus, Trash2, MessageSquare, Clock } from "lucide-react";
import { cn } from "../utils/cn";
import { formatDistanceToNow } from "date-fns";
import type { Conversation } from "../types";

export function Conversations() {
  const { data: conversations, isLoading } = useConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Real-time updates
  useWebSocket("ws://localhost:8080/ws", {
    onConversationUpdate: (conv) => {
      console.log("Conversation updated:", conv);
    },
  });

  const handleCreate = async () => {
    await createConversation.mutateAsync({ title: "New Conversation" });
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this conversation?")) {
      await deleteConversation.mutateAsync(id);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-muted-foreground">Manage your agent conversations</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={createConversation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversation List */}
        <div className="lg:col-span-1 space-y-2">
          {conversations?.map((conv) => (
            <ConversationCard
              key={conv.id}
              conversation={conv}
              isSelected={selectedId === conv.id}
              onClick={() => setSelectedId(conv.id)}
              onDelete={() => handleDelete(conv.id)}
            />
          ))}
          {conversations?.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No conversations yet
            </div>
          )}
        </div>

        {/* Conversation Detail */}
        <div className="lg:col-span-2">
          {selectedId ? (
            <ConversationDetail id={selectedId} />
          ) : (
            <div className="flex items-center justify-center h-64 bg-card rounded-lg border">
              <p className="text-muted-foreground">Select a conversation to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ConversationCardProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function ConversationCard({ conversation, isSelected, onClick, onDelete }: ConversationCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 rounded-lg border cursor-pointer transition-colors group",
        isSelected
          ? "bg-primary/5 border-primary"
          : "bg-card hover:bg-accent"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium truncate">{conversation.title}</h4>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {conversation.messageCount} messages
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-2">
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full",
            conversation.status === "active"
              ? "bg-green-100 text-green-700"
              : conversation.status === "error"
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-700"
          )}
        >
          {conversation.status}
        </span>
      </div>
    </div>
  );
}

function ConversationDetail({ id }: { id: string }) {
  // This would fetch conversation details
  return (
    <div className="bg-card rounded-lg border p-6">
      <h3 className="text-lg font-semibold mb-4">Conversation Details</h3>
      <p className="text-muted-foreground">ID: {id}</p>
      {/* Message list would go here */}
    </div>
  );
}

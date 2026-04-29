import { useState } from "react";
import { useMemoryEntries, useSearchMemory, useDeleteMemory } from "../hooks/useApi";
import { Search, Trash2, Brain, Sparkles, Database } from "lucide-react";
import { cn } from "../utils/cn";
import { formatDistanceToNow } from "date-fns";
import type { MemoryEntry } from "../types";

export function Memory() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: memories, isLoading } = useMemoryEntries();
  const searchMemory = useSearchMemory();
  const deleteMemory = useDeleteMemory();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      await searchMemory.mutateAsync(searchQuery);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this memory entry?")) {
      await deleteMemory.mutateAsync(id);
    }
  };

  const displayMemories = searchMemory.data ?? memories;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Memory</h1>
          <p className="text-muted-foreground">Browse and search agent memory</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="w-4 h-4" />
            <span>{memories?.length ?? 0} entries</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background"
          />
        </div>
        <button
          type="submit"
          disabled={searchMemory.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {searchMemory.isPending ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Memory Grid */}
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayMemories?.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onDelete={() => handleDelete(memory.id)}
            />
          ))}
          {displayMemories?.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No memories found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MemoryCardProps {
  memory: MemoryEntry;
  onDelete: () => void;
}

function MemoryCard({ memory, onDelete }: MemoryCardProps) {
  const typeColors = {
    fact: "bg-blue-100 text-blue-700",
    preference: "bg-purple-100 text-purple-700",
    context: "bg-green-100 text-green-700",
    summary: "bg-orange-100 text-orange-700",
  };

  return (
    <div className="bg-card rounded-lg border p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between mb-3">
        <span className={cn("text-xs px-2 py-0.5 rounded-full", typeColors[memory.type])}>
          {memory.type}
        </span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <p className="text-sm mb-4 line-clamp-3">{memory.content}</p>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          <span>{(memory.confidence * 100).toFixed(0)}% confidence</span>
        </div>
        <span>{formatDistanceToNow(new Date(memory.createdAt))} ago</span>
      </div>

      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        Source: {memory.source}
      </div>
    </div>
  );
}

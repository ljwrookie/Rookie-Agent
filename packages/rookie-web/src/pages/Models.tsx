import { useState } from "react";
import { useModels, useModelHealth, useUpdateModel } from "../hooks/useApi";
import { Cpu, X, Edit2, Save } from "lucide-react";
import { cn } from "../utils/cn";
import type { ModelConfig, ModelHealth } from "../types";

export function Models() {
  const { data: models, isLoading: modelsLoading } = useModels();
  const { data: health } = useModelHealth();
  const updateModel = useUpdateModel();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ModelConfig>>({});

  const handleEdit = (model: ModelConfig) => {
    setEditingId(model.id);
    setEditForm(model);
  };

  const handleSave = async () => {
    if (editingId && editForm) {
      await updateModel.mutateAsync({ ...editForm, id: editingId } as ModelConfig);
      setEditingId(null);
    }
  };

  const getHealthForModel = (modelId: string): ModelHealth | undefined => {
    return health?.find((h) => h.modelId === modelId);
  };

  if (modelsLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Models</h1>
        <p className="text-muted-foreground">Configure and monitor LLM providers</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {models?.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            health={getHealthForModel(model.id)}
            isEditing={editingId === model.id}
            editForm={editForm}
            onEdit={() => handleEdit(model)}
            onSave={handleSave}
            onCancel={() => setEditingId(null)}
            onChange={setEditForm}
            isSaving={updateModel.isPending}
          />
        ))}
      </div>
    </div>
  );
}

interface ModelCardProps {
  model: ModelConfig;
  health?: ModelHealth;
  isEditing: boolean;
  editForm: Partial<ModelConfig>;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (form: Partial<ModelConfig>) => void;
  isSaving: boolean;
}

function ModelCard({
  model,
  health,
  isEditing,
  editForm,
  onEdit,
  onSave,
  onCancel,
  onChange,
  isSaving,
}: ModelCardProps) {
  const statusColors = {
    healthy: "text-green-500",
    degraded: "text-yellow-500",
    unavailable: "text-red-500",
  };

  const statusBg = {
    healthy: "bg-green-500",
    degraded: "bg-yellow-500",
    unavailable: "bg-red-500",
  };

  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">{model.provider}</h3>
            <p className="text-sm text-muted-foreground">{model.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <div className="flex items-center gap-1 text-sm">
              <span className={cn("w-2 h-2 rounded-full", statusBg[health.status])} />
              <span className={statusColors[health.status]}>
                {health.status}
              </span>
            </div>
          )}
          {!isEditing ? (
            <button
              onClick={onEdit}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex gap-1">
              <button
                onClick={onSave}
                disabled={isSaving}
                className="p-1 text-green-500 hover:text-green-600"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={onCancel}
                className="p-1 text-red-500 hover:text-red-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">API Key</label>
            <input
              type="password"
              value={editForm.apiKey || ""}
              onChange={(e) => onChange({ ...editForm, apiKey: e.target.value })}
              className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="text-sm font-medium">Base URL (optional)</label>
            <input
              type="text"
              value={editForm.baseUrl || ""}
              onChange={(e) => onChange({ ...editForm, baseUrl: e.target.value })}
              className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
              placeholder="https://api.example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Temperature</label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={editForm.temperature ?? 0.7}
                onChange={(e) => onChange({ ...editForm, temperature: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Max Tokens</label>
              <input
                type="number"
                value={editForm.maxTokens ?? 4096}
                onChange={(e) => onChange({ ...editForm, maxTokens: parseInt(e.target.value) })}
                className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className={cn("font-medium", model.enabled ? "text-green-500" : "text-gray-500")}>
              {model.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Priority</span>
            <span className="font-medium">{model.priority}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Temperature</span>
            <span className="font-medium">{model.temperature ?? 0.7}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Max Tokens</span>
            <span className="font-medium">{model.maxTokens ?? 4096}</span>
          </div>
          {health && (
            <>
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Latency</span>
                  <span className="font-medium">{health.latency}ms</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium">{(health.successRate * 100).toFixed(1)}%</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

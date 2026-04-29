import { useState } from "react";
import { Settings2, Save, RefreshCw } from "lucide-react";
import { cn } from "../utils/cn";

export function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your Rookie Agent</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <nav className="space-y-1">
            {[
              { id: "general", label: "General" },
              { id: "memory", label: "Memory" },
              { id: "permissions", label: "Permissions" },
              { id: "hooks", label: "Hooks" },
              { id: "advanced", label: "Advanced" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full text-left px-4 py-2 rounded-md text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="bg-card rounded-lg border p-6">
            {activeTab === "general" && <GeneralSettings />}
            {activeTab === "memory" && <MemorySettings />}
            {activeTab === "permissions" && <PermissionSettings />}
            {activeTab === "hooks" && <HookSettings />}
            {activeTab === "advanced" && <AdvancedSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Settings2 className="w-5 h-5" />
        General Settings
      </h2>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Agent Name</label>
          <input
            type="text"
            defaultValue="Rookie"
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Default Language</label>
          <select className="w-full mt-1 px-3 py-2 border rounded-md bg-background">
            <option value="en">English</option>
            <option value="zh">Chinese</option>
            <option value="ja">Japanese</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="autoSave" defaultChecked />
          <label htmlFor="autoSave" className="text-sm">
            Auto-save conversations
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="telemetry" />
          <label htmlFor="telemetry" className="text-sm">
            Enable telemetry
          </label>
        </div>
      </div>
    </div>
  );
}

function MemorySettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Memory Settings</h2>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Max Memory Entries</label>
          <input
            type="number"
            defaultValue={10000}
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Embedding Model</label>
          <select className="w-full mt-1 px-3 py-2 border rounded-md bg-background">
            <option value="openai">OpenAI</option>
            <option value="local">Local</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="autoCompact" defaultChecked />
          <label htmlFor="autoCompact" className="text-sm">
            Auto-compact old memories
          </label>
        </div>
      </div>
    </div>
  );
}

function PermissionSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Permission Settings</h2>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Default Permission Level</label>
          <select className="w-full mt-1 px-3 py-2 border rounded-md bg-background">
            <option value="ask">Ask</option>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Max Consecutive Denials</label>
          <input
            type="number"
            defaultValue={3}
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="confirmDestructive" defaultChecked />
          <label htmlFor="confirmDestructive" className="text-sm">
            Confirm destructive operations
          </label>
        </div>
      </div>
    </div>
  );
}

function HookSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Hook Settings</h2>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="enableHooks" defaultChecked />
          <label htmlFor="enableHooks" className="text-sm">
            Enable hooks
          </label>
        </div>

        <div>
          <label className="text-sm font-medium">Default Timeout (ms)</label>
          <input
            type="number"
            defaultValue={30000}
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Max Retries</label>
          <input
            type="number"
            defaultValue={3}
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
          />
        </div>
      </div>
    </div>
  );
}

function AdvancedSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Advanced Settings</h2>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Log Level</label>
          <select className="w-full mt-1 px-3 py-2 border rounded-md bg-background">
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="debugMode" />
          <label htmlFor="debugMode" className="text-sm">
            Debug mode
          </label>
        </div>

        <div className="p-4 bg-yellow-50 rounded-lg">
          <p className="text-sm text-yellow-800">
            Warning: Advanced settings can affect system stability. Change with caution.
          </p>
        </div>
      </div>
    </div>
  );
}

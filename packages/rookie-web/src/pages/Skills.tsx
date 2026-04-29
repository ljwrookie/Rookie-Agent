import { useSkills, useToggleSkill } from "../hooks/useApi";
import { Wrench, Check, X, RefreshCw } from "lucide-react";
import { cn } from "../utils/cn";
import type { Skill } from "../types";

export function Skills() {
  const { data: skills, isLoading } = useSkills();
  const toggleSkill = useToggleSkill();

  const handleToggle = async (skill: Skill) => {
    await toggleSkill.mutateAsync({
      id: skill.id,
      enabled: skill.status !== "active",
    });
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const activeSkills = skills?.filter((s) => s.status === "active") ?? [];
  const inactiveSkills = skills?.filter((s) => s.status !== "active") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-muted-foreground">Manage agent skills and capabilities</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span>{activeSkills.length} active</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-300 rounded-full" />
            <span>{inactiveSkills.length} inactive</span>
          </div>
        </div>
      </div>

      {/* Active Skills */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Active Skills</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggle={() => handleToggle(skill)}
              isLoading={toggleSkill.isPending}
            />
          ))}
          {activeSkills.length === 0 && (
            <div className="col-span-full text-center py-8 text-muted-foreground">
              No active skills
            </div>
          )}
        </div>
      </div>

      {/* Inactive Skills */}
      {inactiveSkills.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Inactive Skills</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {inactiveSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={() => handleToggle(skill)}
                isLoading={toggleSkill.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SkillCardProps {
  skill: Skill;
  onToggle: () => void;
  isLoading: boolean;
}

function SkillCard({ skill, onToggle, isLoading }: SkillCardProps) {
  const isActive = skill.status === "active";

  return (
    <div
      className={cn(
        "bg-card rounded-lg border p-4 transition-all",
        isActive ? "border-primary/50" : "opacity-75"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Wrench className="w-5 h-5 text-primary" />
        </div>
        <button
          onClick={onToggle}
          disabled={isLoading}
          className={cn(
            "flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors",
            isActive
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          )}
        >
          {isLoading ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : isActive ? (
            <>
              <Check className="w-3 h-3" />
              Active
            </>
          ) : (
            <>
              <X className="w-3 h-3" />
              Inactive
            </>
          )}
        </button>
      </div>

      <h3 className="font-semibold mb-1">{skill.name}</h3>
      <p className="text-sm text-muted-foreground mb-3">{skill.description}</p>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {skill.tools.map((tool) => (
            <span
              key={tool}
              className="text-xs px-2 py-0.5 bg-secondary rounded"
            >
              {tool}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>v{skill.version}</span>
          <span>{skill.usageCount} uses</span>
        </div>
      </div>
    </div>
  );
}

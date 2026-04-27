// Project Instructions types (from Claude Code CLAUDE.md -> ROOKIE.md)

export interface InstructionLayer {
  level: "global" | "project" | "subdirectory" | "session";
  path: string;
  content: string;
}

export interface ProjectInstructions {
  layers: InstructionLayer[];
  merged: string;  // Final merged content
}

export interface MemoryCandidate {
  type: "build_command" | "debug_tip" | "env_issue" | "api_pattern" | "convention";
  content: string;
  confidence: number;
  source: string;
}

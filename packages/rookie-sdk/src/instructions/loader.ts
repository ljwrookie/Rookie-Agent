import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { InstructionLayer, ProjectInstructions } from "./types.js";

/**
 * ROOKIE.md loader: loads and merges layered project instructions.
 * Follows Claude Code's CLAUDE.md convention.
 *
 * Layers (later overrides earlier):
 *   1. Global: ~/.rookie/ROOKIE.md
 *   2. Project: <projectRoot>/.rookie/ROOKIE.md
 *   3. Subdirectory: <cwd>/.rookie/ROOKIE.md (if different from project root)
 *   4. Session: passed in at runtime
 */
export class InstructionLoader {
  async load(projectRoot: string, cwd?: string): Promise<ProjectInstructions> {
    const layers: InstructionLayer[] = [];

    // 1. Global
    const globalPath = path.join(os.homedir(), ".rookie", "ROOKIE.md");
    const globalContent = await this.readFile(globalPath);
    if (globalContent) {
      layers.push({ level: "global", path: globalPath, content: globalContent });
    }

    // 2. Project
    const projectPath = path.join(projectRoot, ".rookie", "ROOKIE.md");
    const projectContent = await this.readFile(projectPath);
    if (projectContent) {
      layers.push({ level: "project", path: projectPath, content: projectContent });
    }

    // 3. Subdirectory (if cwd is different from project root)
    if (cwd && cwd !== projectRoot) {
      const subdirPath = path.join(cwd, ".rookie", "ROOKIE.md");
      const subdirContent = await this.readFile(subdirPath);
      if (subdirContent) {
        layers.push({ level: "subdirectory", path: subdirPath, content: subdirContent });
      }
    }

    // Merge
    const merged = layers.map((l) => l.content).join("\n\n---\n\n");

    return { layers, merged };
  }

  addSessionInstructions(
    instructions: ProjectInstructions,
    sessionContent: string
  ): ProjectInstructions {
    const newLayer: InstructionLayer = {
      level: "session",
      path: "<session>",
      content: sessionContent,
    };
    return {
      layers: [...instructions.layers, newLayer],
      merged: instructions.merged + "\n\n---\n\n" + sessionContent,
    };
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}

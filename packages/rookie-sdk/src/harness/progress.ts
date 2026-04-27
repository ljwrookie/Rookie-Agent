import * as fs from "fs/promises";
import * as path from "path";

export interface ProgressData {
  taskName: string;
  taskDescription: string;
  environment: Record<string, string>;
  completed: ProgressEntry[];
  inProgress: ProgressEntry[];
  pending: ProgressEntry[];
  knownIssues: string[];
  lastSessionSummary: string;
}

export interface ProgressEntry {
  featureId: string;
  description: string;
  sessionId?: string;
  completedAt?: string;
}

/**
 * Manages the .rookie/progress.md file.
 * Format follows Harness convention for cross-session continuity.
 */
export class ProgressManager {
  private filePath: string;

  constructor(projectRoot: string, fileName?: string) {
    this.filePath = path.join(projectRoot, ".rookie", fileName || "progress.md");
  }

  async read(): Promise<ProgressData | null> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return this.parse(content);
    } catch {
      return null;
    }
  }

  async write(data: ProgressData): Promise<void> {
    const content = this.serialize(data);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, content, "utf-8");
  }

  async markCompleted(featureId: string, sessionId: string): Promise<void> {
    const data = await this.read();
    if (!data) return;

    // Move from inProgress/pending to completed
    const fromInProgress = data.inProgress.findIndex((e) => e.featureId === featureId);
    const fromPending = data.pending.findIndex((e) => e.featureId === featureId);

    let entry: ProgressEntry | undefined;
    if (fromInProgress >= 0) {
      entry = data.inProgress.splice(fromInProgress, 1)[0];
    } else if (fromPending >= 0) {
      entry = data.pending.splice(fromPending, 1)[0];
    }

    if (entry) {
      entry.sessionId = sessionId;
      entry.completedAt = new Date().toISOString();
      data.completed.push(entry);
      await this.write(data);
    }
  }

  async markInProgress(featureId: string): Promise<void> {
    const data = await this.read();
    if (!data) return;

    const fromPending = data.pending.findIndex((e) => e.featureId === featureId);
    if (fromPending >= 0) {
      const entry = data.pending.splice(fromPending, 1)[0];
      data.inProgress.push(entry);
      await this.write(data);
    }
  }

  async updateSessionSummary(summary: string): Promise<void> {
    const data = await this.read();
    if (!data) return;
    data.lastSessionSummary = summary;
    await this.write(data);
  }

  // ── Serialization ────────────────────────────────────────

  private serialize(data: ProgressData): string {
    let md = `# Rookie Progress: ${data.taskName}\n\n`;

    md += `## Task Description\n${data.taskDescription}\n\n`;

    md += `## Environment\n`;
    for (const [key, value] of Object.entries(data.environment)) {
      md += `- ${key}: ${value}\n`;
    }
    md += `\n`;

    md += `## Completed\n`;
    for (const entry of data.completed) {
      md += `- [x] ${entry.featureId}: ${entry.description}`;
      if (entry.sessionId) md += ` (${entry.sessionId}`;
      if (entry.completedAt) md += `, ${entry.completedAt}`;
      if (entry.sessionId) md += `)`;
      md += `\n`;
    }
    md += `\n`;

    md += `## In Progress\n`;
    for (const entry of data.inProgress) {
      md += `- [ ] ${entry.featureId}: ${entry.description}\n`;
    }
    md += `\n`;

    md += `## Pending\n`;
    for (const entry of data.pending) {
      md += `- [ ] ${entry.featureId}: ${entry.description}\n`;
    }
    md += `\n`;

    if (data.knownIssues.length > 0) {
      md += `## Known Issues\n`;
      for (const issue of data.knownIssues) {
        md += `- ${issue}\n`;
      }
      md += `\n`;
    }

    if (data.lastSessionSummary) {
      md += `## Last Session Summary\n${data.lastSessionSummary}\n`;
    }

    return md;
  }

  private parse(content: string): ProgressData {
    const data: ProgressData = {
      taskName: "",
      taskDescription: "",
      environment: {},
      completed: [],
      inProgress: [],
      pending: [],
      knownIssues: [],
      lastSessionSummary: "",
    };

    const lines = content.split("\n");
    let section = "";

    for (const line of lines) {
      // Section headers
      if (line.startsWith("# Rookie Progress: ")) {
        data.taskName = line.replace("# Rookie Progress: ", "").trim();
        continue;
      }
      if (line.startsWith("## ")) {
        section = line.replace("## ", "").trim().toLowerCase();
        continue;
      }

      // Content by section
      if (section === "task description" && line.trim()) {
        data.taskDescription += (data.taskDescription ? "\n" : "") + line;
      } else if (section === "environment" && line.startsWith("- ")) {
        const [key, ...rest] = line.slice(2).split(": ");
        data.environment[key.trim()] = rest.join(": ").trim();
      } else if (section === "completed" && line.startsWith("- [x] ")) {
        const entry = this.parseEntry(line.slice(6));
        if (entry) data.completed.push(entry);
      } else if (section === "in progress" && line.startsWith("- [ ] ")) {
        const entry = this.parseEntry(line.slice(6));
        if (entry) data.inProgress.push(entry);
      } else if (section === "pending" && line.startsWith("- [ ] ")) {
        const entry = this.parseEntry(line.slice(6));
        if (entry) data.pending.push(entry);
      } else if (section === "known issues" && line.startsWith("- ")) {
        data.knownIssues.push(line.slice(2).trim());
      } else if (section === "last session summary" && line.trim()) {
        data.lastSessionSummary += (data.lastSessionSummary ? "\n" : "") + line;
      }
    }

    return data;
  }

  private parseEntry(text: string): ProgressEntry | null {
    const match = text.match(/^([^:]+):\s*(.+?)(?:\s*\(([^)]+)\))?$/);
    if (!match) return null;

    const [, featureId, description, meta] = match;
    const entry: ProgressEntry = {
      featureId: featureId.trim(),
      description: description.trim(),
    };

    if (meta) {
      const parts = meta.split(",").map((s) => s.trim());
      if (parts[0]) entry.sessionId = parts[0];
      if (parts[1]) entry.completedAt = parts[1];
    }

    return entry;
  }
}

import * as fs from "fs/promises";
import * as path from "path";
import { Feature } from "./types.js";

export interface FeatureList {
  task: string;
  created: string;
  features: Feature[];
}

/**
 * Manages the .rookie/features.json file.
 * Stores the decomposed feature list with verification commands and status.
 */
export class FeatureListManager {
  private filePath: string;

  constructor(projectRoot: string, fileName?: string) {
    this.filePath = path.join(projectRoot, ".rookie", fileName || "features.json");
  }

  async read(): Promise<FeatureList | null> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(content) as FeatureList;
    } catch {
      return null;
    }
  }

  async write(data: FeatureList): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async create(task: string, features: Feature[]): Promise<FeatureList> {
    const data: FeatureList = {
      task,
      created: new Date().toISOString(),
      features,
    };
    await this.write(data);
    return data;
  }

  async getNextPending(): Promise<Feature | null> {
    const data = await this.read();
    if (!data) return null;
    return data.features.find((f) => f.status === "pending") || null;
  }

  async getCurrent(): Promise<Feature | null> {
    const data = await this.read();
    if (!data) return null;
    return data.features.find((f) => f.status === "in_progress") || null;
  }

  async updateStatus(
    featureId: string,
    status: Feature["status"],
    error?: string
  ): Promise<void> {
    const data = await this.read();
    if (!data) return;

    const feature = data.features.find((f) => f.id === featureId);
    if (!feature) return;

    feature.status = status;
    if (status === "in_progress" || status === "failed") {
      feature.attempts++;
    }
    if (error) {
      feature.lastError = error;
    }

    await this.write(data);
  }

  async getSummary(): Promise<{ total: number; completed: number; failed: number; pending: number }> {
    const data = await this.read();
    if (!data) return { total: 0, completed: 0, failed: 0, pending: 0 };

    return {
      total: data.features.length,
      completed: data.features.filter((f) => f.status === "passed").length,
      failed: data.features.filter((f) => f.status === "failed" || f.status === "skipped").length,
      pending: data.features.filter((f) => f.status === "pending" || f.status === "in_progress").length,
    };
  }
}

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface ModelConfig {
  name: string;
  provider: string;
  baseURL?: string;
}

export interface RookieConfig {
  models: ModelConfig[];
  apiKeys: Record<string, string>;
  defaultModel?: string;
}

export class ConfigManager {
  private configPath: string;
  private config?: RookieConfig;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), ".rookie", "config.json");
  }

  async load(): Promise<RookieConfig> {
    try {
      const content = await fs.readFile(this.configPath, "utf-8");
      this.config = JSON.parse(content) as RookieConfig;
      return this.config;
    } catch {
      // Return default config
      this.config = { models: [], apiKeys: {} };
      return this.config;
    }
  }

  async save(config: RookieConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    this.config = config;
  }

  getConfig(): RookieConfig | undefined {
    return this.config;
  }

  // Load from environment variables
  static fromEnv(): RookieConfig {
    const config: RookieConfig = {
      models: [],
      apiKeys: {},
    };

    // Parse CUSTOM_MODELS
    const customModels = process.env.CUSTOM_MODELS;
    if (customModels) {
      try {
        const models = JSON.parse(customModels) as ModelConfig[];
        config.models = models;
      } catch (e) {
        console.warn("Failed to parse CUSTOM_MODELS:", e);
      }
    }

    // Parse API keys
    if (process.env.ARK_API_KEY) {
      config.apiKeys["ark"] = process.env.ARK_API_KEY;
      config.apiKeys["openai"] = process.env.ARK_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
      config.apiKeys["openai"] = process.env.OPENAI_API_KEY;
    }

    return config;
  }

  // Get provider config by name
  getModelConfig(name: string): ModelConfig | undefined {
    return this.config?.models.find((m) => m.name === name);
  }

  // Get API key for provider
  getApiKey(provider: string): string | undefined {
    return this.config?.apiKeys[provider];
  }
}

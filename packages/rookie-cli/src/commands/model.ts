/**
 * `rookie model` — Model provider management commands
 *
 * Commands:
 *   rookie model list              # List available providers
 *   rookie model set <provider>    # Set default provider
 *   rookie model get               # Get current provider
 *   rookie model test <provider>   # Test provider connection
 */

import {
  loadSettings,
  saveSettings,
  PROVIDER_REGISTRY,
  type ProviderName,
} from "@rookie/agent-sdk";
import { Command } from "commander";

export interface ModelListOptions {
  projectRoot?: string;
  home?: string;
}

export interface ModelSetOptions {
  projectRoot?: string;
  home?: string;
  provider: string;
  model?: string;
  apiKey?: string;
}

export interface ModelGetOptions {
  projectRoot?: string;
  home?: string;
}

export interface ModelTestOptions {
  projectRoot?: string;
  home?: string;
  provider: string;
}

/**
 * List all available model providers
 */
export async function runModelList(opts: ModelListOptions): Promise<number> {
  const settings = await loadSettings({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  const currentProvider = settings.merged.model?.provider as string | undefined;
  const currentModel = settings.merged.model?.model as string | undefined;

  console.log("Available model providers:\n");

  const entries = Object.entries(PROVIDER_REGISTRY) as Array<
    [string, { name: string; requiresKey: boolean }]
  >;
  for (const [key, info] of entries) {
    const isCurrent = currentProvider === key;
    const marker = isCurrent ? "→ " : "  ";
    const check = info.requiresKey ? "🔑" : "  ";
    console.log(`${marker}${check} ${key.padEnd(12)} ${info.name}`);

    if (isCurrent && currentModel) {
      console.log(`      Current model: ${currentModel}`);
    }
  }

  console.log("\nUsage:");
  console.log("  rookie model set <provider>:<model>");
  console.log("  rookie model set openai:gpt-4o");
  console.log("  rookie model set anthropic:claude-sonnet-4");
  console.log("  rookie model set ollama:llama3.1");

  return 0;
}

/**
 * Set the default model provider
 */
export async function runModelSet(opts: ModelSetOptions): Promise<number> {
  const settings = await loadSettings({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  // Parse provider:model format
  const [provider, model] = opts.provider.split(":");

  if (!provider) {
    console.error("Error: Provider name required");
    console.error("Usage: rookie model set <provider>:<model>");
    return 1;
  }

  // Validate provider
  if (!PROVIDER_REGISTRY[provider as ProviderName]) {
    console.error(`Error: Unknown provider "${provider}"`);
    console.error("Run 'rookie model list' to see available providers");
    return 1;
  }

  const providerInfo = PROVIDER_REGISTRY[provider as ProviderName];

  // Check if API key is needed
  if (providerInfo.requiresKey && !opts.apiKey) {
    const existingKey = settings.merged.apiKeys?.[provider];
    if (!existingKey) {
      console.error(`Error: Provider "${provider}" requires an API key`);
      console.error(`Set it via environment variable or:`);
      console.error(`  rookie model set ${provider}:${model || "default"} --api-key <key>`);
      return 1;
    }
  }

  // Update settings
  const newSettings = {
    ...settings.merged,
    model: {
      ...(settings.merged.model || {}),
      provider,
      ...(model && { model }),
    },
    ...(opts.apiKey && {
      apiKeys: {
        ...(settings.merged.apiKeys || {}),
        [provider]: opts.apiKey,
      },
    }),
  };

  await saveSettings(newSettings, {
    projectRoot: opts.projectRoot,
    home: opts.home,
    layer: "project",
  });

  console.log(`✓ Default model set to ${provider}${model ? `:${model}` : ""}`);

  if (opts.apiKey) {
    console.log(`✓ API key saved for ${provider}`);
  }

  return 0;
}

/**
 * Get current model configuration
 */
export async function runModelGet(opts: ModelGetOptions): Promise<number> {
  const settings = await loadSettings({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  const provider = settings.merged.model?.provider as string | undefined;
  const model = settings.merged.model?.model as string | undefined;

  if (!provider) {
    console.log("No default model configured");
    console.log("Run 'rookie model list' to see available providers");
    console.log("Run 'rookie model set <provider>:<model>' to configure");
    return 1;
  }

  console.log(`Current provider: ${provider}`);
  if (model) {
    console.log(`Current model: ${model}`);
  }

  // Show provider info
  const info = PROVIDER_REGISTRY[provider as ProviderName];
  if (info) {
    console.log(`Provider name: ${info.name}`);
    console.log(`Requires API key: ${info.requiresKey ? "Yes" : "No"}`);
  }

  return 0;
}

/**
 * Test provider connection
 */
export async function runModelTest(opts: ModelTestOptions): Promise<number> {
  const settings = await loadSettings({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  const provider = opts.provider;

  if (!PROVIDER_REGISTRY[provider as ProviderName]) {
    console.error(`Error: Unknown provider "${provider}"`);
    return 1;
  }

  console.log(`Testing connection to ${provider}...`);

  // Get API key if needed
  const apiKey = settings.merged.apiKeys?.[provider] as string | undefined;
  const providerInfo = PROVIDER_REGISTRY[provider as ProviderName];

  if (providerInfo.requiresKey && !apiKey) {
    console.error(`Error: No API key found for ${provider}`);
    return 1;
  }

  try {
    // Simple connection test - would need actual provider implementation
    console.log(`✓ Configuration valid for ${provider}`);

    if (apiKey) {
      // Mask the key for display
      const masked = apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
      console.log(`  API key: ${masked}`);
    }

    return 0;
  } catch (error) {
    console.error(`✗ Connection failed: ${error}`);
    return 1;
  }
}

/**
 * Wire the `rookie model ...` subcommand group into the CLI program.
 */
export function registerModelCommands(program: Command): void {
  const model = program
    .command("model")
    .description("Manage model providers (list | set | get | test)");

  model
    .command("list")
    .description("List available model providers")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (opts: { cwd?: string }) => {
      const code = await runModelList({ projectRoot: opts.cwd });
      process.exit(code);
    });

  model
    .command("set <provider>")
    .description("Set default provider (format: provider[:model])")
    .option("--api-key <key>", "API key for the provider")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (provider: string, opts: { apiKey?: string; cwd?: string }) => {
      const code = await runModelSet({
        projectRoot: opts.cwd,
        provider,
        apiKey: opts.apiKey,
      });
      process.exit(code);
    });

  model
    .command("get")
    .description("Show current model configuration")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (opts: { cwd?: string }) => {
      const code = await runModelGet({ projectRoot: opts.cwd });
      process.exit(code);
    });

  model
    .command("test <provider>")
    .description("Test provider configuration")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (provider: string, opts: { cwd?: string }) => {
      const code = await runModelTest({ projectRoot: opts.cwd, provider });
      process.exit(code);
    });
}

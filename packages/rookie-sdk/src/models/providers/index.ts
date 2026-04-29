/**
 * Model Providers
 *
 * 8 supported providers:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Anthropic (Claude)
 * - OpenRouter (unified API)
 * - AWS Bedrock
 * - Google Gemini
 * - Ollama (local)
 * - Mistral AI
 * - Custom (OpenAI-compatible)
 */

export { OpenAIProvider, OpenAIConfig } from "./openai.js";
export { AnthropicProvider, AnthropicConfig } from "./anthropic.js";
export { OpenRouterProvider } from "./openrouter.js";
export { BedrockProvider, BedrockConfig } from "./bedrock.js";
export { GeminiProvider, GeminiConfig } from "./gemini.js";
export { OllamaProvider, OllamaConfig } from "./ollama.js";
export { MistralProvider, MistralConfig } from "./mistral.js";
export { CustomProvider, CustomProviderConfig } from "./custom.js";

// Provider registry for CLI
export const PROVIDER_REGISTRY = {
  openai: { name: "OpenAI", requiresKey: true },
  anthropic: { name: "Anthropic", requiresKey: true },
  openrouter: { name: "OpenRouter", requiresKey: true },
  bedrock: { name: "AWS Bedrock", requiresKey: true },
  gemini: { name: "Google Gemini", requiresKey: true },
  ollama: { name: "Ollama (Local)", requiresKey: false },
  mistral: { name: "Mistral AI", requiresKey: true },
  custom: { name: "Custom Endpoint", requiresKey: true },
} as const;

export type ProviderName = keyof typeof PROVIDER_REGISTRY;

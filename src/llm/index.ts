/**
 * createLLMClient — turns an `llm` config into an LLMClient.
 * Built-in "anthropic"/"openai", or a custom resolve function.
 */
import type { LLMConfig } from "../types.js";
import type { LLMClient } from "./types.js";
import { AnthropicClient } from "./anthropic.js";
import { OpenAIClient } from "./openai.js";

export function createLLMClient(config: LLMConfig): LLMClient {
  const { provider } = config;

  if (typeof provider === "function") {
    // Custom function — the escape hatch. Nobody is blocked.
    return { model: config.model ?? "custom", resolve: provider };
  }
  if (provider === "anthropic") return new AnthropicClient(config);
  if (provider === "openai") return new OpenAIClient(config);

  throw new Error(
    `Unknown llm provider "${String(provider)}". Use "anthropic", "openai", or a function.`,
  );
}

export type { LLMClient };

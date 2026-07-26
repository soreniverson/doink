/**
 * Anthropic Messages API client (fetch-based, no SDK dependency).
 * BYO key. Only used when you call ai(...).
 */
import type { LLMConfig, LLMResolveInput, LLMResolveOutput } from "../types.js";
import type { LLMClient } from "./types.js";
import { SYSTEM_PROMPT, buildUserPrompt, parseResolveOutput } from "./prompt.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_BASE = "https://api.anthropic.com";

export class AnthropicClient implements LLMClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic provider requires an API key. Set llm.apiKey or ANTHROPIC_API_KEY.",
      );
    }
    this.apiKey = apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async resolve(input: LLMResolveInput): Promise<LLMResolveOutput> {
    const content: unknown[] = [{ type: "text", text: buildUserPrompt(input) }];
    if (input.screenshot) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: input.screenshot.toString("base64"),
        },
      });
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await safeText(res)}`);
    }
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return parseResolveOutput(text);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

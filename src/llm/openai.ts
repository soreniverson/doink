/**
 * OpenAI Chat Completions client (fetch-based, no SDK dependency).
 * BYO key. Only used when you call ai(...).
 */
import type { LLMConfig, LLMResolveInput, LLMResolveOutput } from "../types.js";
import type { LLMClient } from "./types.js";
import { SYSTEM_PROMPT, buildUserPrompt, parseResolveOutput } from "./prompt.js";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_BASE = "https://api.openai.com";

export class OpenAIClient implements LLMClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI provider requires an API key. Set llm.apiKey or OPENAI_API_KEY.");
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
        type: "image_url",
        image_url: { url: `data:image/png;base64,${input.screenshot.toString("base64")}` },
      });
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${await safeText(res)}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
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

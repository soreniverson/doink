/**
 * Shared prompt construction + response parsing for the built-in providers.
 * Both Anthropic and OpenAI get the same instructions and JSON contract, so
 * behavior is consistent regardless of the key you bring.
 */
import type { LLMResolveInput, LLMResolveOutput } from "../types.js";

export const SYSTEM_PROMPT =
  "You are a precise browser automation resolver. You are given a page URL, a " +
  "list of interactive elements (each with a CSS selector), and an optional " +
  "screenshot. Resolve the user's instruction to concrete CSS selectors that " +
  "ALREADY appear in the element list. Prefer the exact selector shown. Respond " +
  "with ONLY a single JSON object, no prose, no code fences.";

export function buildUserPrompt(input: LLMResolveInput): string {
  const header = `URL: ${input.url}\n\nInteractive elements:\n${input.snapshot || "(none captured)"}\n\n`;
  switch (input.kind) {
    case "locate":
      return (
        header +
        `Instruction: find the single element best matching: "${input.instruction}".\n` +
        `Respond as {"selector": "<css selector from the list>"}.`
      );
    case "observe":
      return (
        header +
        `Instruction: list the elements matching: "${input.instruction}".\n` +
        `Respond as {"selectors": ["<css>", "..."]} using selectors from the list.`
      );
    case "extract": {
      const shape = input.jsonSchema
        ? `\nTarget shape (JSON Schema): ${JSON.stringify(input.jsonSchema)}`
        : "";
      return (
        header +
        `Instruction: for extracting "${input.instruction}", map each desired field ` +
        `to the CSS selector whose text contains that field's value.${shape}\n` +
        `Respond as {"selectorMap": {"<field>": "<css selector from the list>"}}.`
      );
    }
  }
}

/** Pull the first JSON object out of a model response and shape it. */
export function parseResolveOutput(text: string): LLMResolveOutput {
  const json = extractJson(text);
  const out: LLMResolveOutput = {};
  if (typeof json.selector === "string") out.selector = json.selector;
  if (json.selectorMap && typeof json.selectorMap === "object") {
    out.selectorMap = coerceStringMap(json.selectorMap as Record<string, unknown>);
  }
  if (Array.isArray(json.selectors)) {
    out.selectors = json.selectors.filter((s): s is string => typeof s === "string");
  }
  if ("data" in json) out.data = json.data;
  if (typeof json.reasoning === "string") out.reasoning = json.reasoning;
  return out;
}

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Fall back to the first {...} block.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        /* give up below */
      }
    }
    throw new Error(`LLM did not return parseable JSON: ${text.slice(0, 200)}`);
  }
}

function coerceStringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

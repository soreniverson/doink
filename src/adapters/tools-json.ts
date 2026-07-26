/**
 * Raw JSON tool-schema adapter (Phase 6) — the most universal integration.
 *
 * Exports function-calling tool definitions that map 1:1 to the nine primitives,
 * in OpenAI or Anthropic shape, plus a dispatcher that executes a model's tool
 * call against a ComputerClient and returns a result the model can read.
 *
 * The freeze contract still holds: a tool call is deterministic (a plain
 * selector) unless it sets `ai: true`, which is the visible, cached LLM path.
 */
import { ai } from "../ai.js";
import { ComputerError } from "../errors.js";
import type { ComputerClient } from "../client.js";
import type { Observation } from "../types.js";

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface DispatchResult {
  name: string;
  ok: boolean;
  /** A compact, model-readable string (extracted data, an observation list, or an error + hint). */
  content: string;
  /** The structured value, when there is one. */
  data?: unknown;
  error?: { suggestion?: string; found?: string };
}

/** A tool call as emitted by a model. `arguments` may be a JSON string (OpenAI) or object (Anthropic). */
export interface ToolCall {
  name: string;
  arguments: string | Record<string, unknown>;
}

const TARGET_PROP = {
  target: {
    type: "string",
    description: "A CSS selector (free/deterministic), OR a natural-language description if ai=true.",
  },
  ai: {
    type: "boolean",
    description: "Resolve `target` with the LLM instead of treating it as a selector. Cached after the first call. Default false.",
  },
  timeoutMs: {
    type: "number",
    description: "Max time to wait for the element, in ms. Default 15000.",
  },
} as const;

/** The neutral tool schemas — one per primitive. */
export const computerToolSchemas: ToolSchema[] = [
  {
    name: "browser_goto",
    description: "Navigate to a URL.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to open." } },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Click an element.",
    parameters: {
      type: "object",
      properties: { ...TARGET_PROP },
      required: ["target"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into a field (clears it first by default).",
    parameters: {
      type: "object",
      properties: {
        ...TARGET_PROP,
        text: { type: "string", description: "The text to type." },
        pressEnter: { type: "boolean", description: "Press Enter after typing. Default false." },
      },
      required: ["target", "text"],
    },
  },
  {
    name: "browser_read",
    description: "Read visible text from the page, or from a selector when given.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "Optional CSS selector to scope the read." } },
    },
  },
  {
    name: "browser_extract",
    description:
      "Extract structured data. Provide `fields` (a map of name->CSS selector) for the free path, or `instruction` for the cached LLM path.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Map of field name -> CSS selector (deterministic).",
        },
        instruction: {
          type: "string",
          description: "Natural-language description of what to extract (uses the LLM, cached).",
        },
      },
    },
  },
  {
    name: "browser_observe",
    description:
      "List actionable elements on the page (role + a stable selector). Optionally scope with `scope` (a selector) or describe what to find with `instruction` (LLM).",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Optional CSS selector to scope the scan." },
        instruction: { type: "string", description: "Natural-language description of what to find (uses the LLM, cached)." },
        limit: { type: "number", description: "Max elements to return. Default 50." },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot (saved to the trace dir). Returns the path + size, not the image bytes.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Optional CSS selector to screenshot a single element." },
        fullPage: { type: "boolean", description: "Capture the full scrollable page. Default false." },
      },
    },
  },
  {
    name: "browser_download",
    description: "Click a control that triggers a download and capture the file.",
    parameters: {
      type: "object",
      properties: { ...TARGET_PROP, saveAs: { type: "string", description: "Optional path to save the file as." } },
      required: ["target"],
    },
  },
  {
    name: "browser_wait_for",
    description: "Wait until an element is present/visible. Give a CSS selector, or a description with ai=true.",
    parameters: {
      type: "object",
      properties: { ...TARGET_PROP },
      required: ["target"],
    },
  },
];

// ---- provider-shaped exports ----------------------------------------------

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Get the tool definitions in a provider's function-calling shape. */
export function computerTools(format: "openai"): OpenAITool[];
export function computerTools(format: "anthropic"): AnthropicTool[];
export function computerTools(format: "openai" | "anthropic"): OpenAITool[] | AnthropicTool[] {
  if (format === "openai") {
    return computerToolSchemas.map((s) => ({
      type: "function",
      function: { name: s.name, description: s.description, parameters: s.parameters },
    }));
  }
  return computerToolSchemas.map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.parameters,
  }));
}

// ---- the dispatcher --------------------------------------------------------

/** Build a dispatcher that executes model tool calls against a client. */
export function createDispatcher(client: ComputerClient) {
  return async function dispatch(call: ToolCall): Promise<DispatchResult> {
    const args = normalizeArgs(call.arguments);
    try {
      switch (call.name) {
        case "browser_goto": {
          const r = await client.goto(str(args.url));
          return ok(call.name, `Navigated to ${r.url} (HTTP ${r.status ?? "?"}).`, r);
        }
        case "browser_click": {
          const r = await client.click(targetOf(args), { timeout: timeoutOf(args) });
          return ok(call.name, `Clicked ${r.target.selector}.`, r);
        }
        case "browser_type": {
          const r = await client.type(targetOf(args), str(args.text), {
            pressEnter: bool(args.pressEnter),
            timeout: timeoutOf(args),
          });
          return ok(call.name, `Typed into ${r.target.selector}.`, r);
        }
        case "browser_read": {
          const text = await client.read(args.selector ? { selector: str(args.selector) } : {});
          return ok(call.name, truncate(text, 4000), text);
        }
        case "browser_extract": {
          if (args.instruction) {
            const data = await client.extract(
              ai({ schema: { parse: (x) => x }, instruction: str(args.instruction) }),
            );
            return ok(call.name, JSON.stringify(data), data);
          }
          const fields = (args.fields ?? {}) as Record<string, string>;
          const data = await client.extract(fields);
          return ok(call.name, JSON.stringify(data), data);
        }
        case "browser_observe": {
          const target = args.instruction
            ? ai(str(args.instruction))
            : args.scope
              ? str(args.scope)
              : undefined;
          const obs = await client.observe(target, args.limit ? { limit: num(args.limit) } : {});
          return ok(call.name, formatObservations(obs), obs);
        }
        case "browser_screenshot": {
          const buf = await client.screenshot({
            selector: args.selector ? str(args.selector) : undefined,
            fullPage: bool(args.fullPage),
          });
          return ok(call.name, `Screenshot captured (${buf.length} bytes, saved to trace dir).`, {
            bytes: buf.length,
          });
        }
        case "browser_download": {
          const r = await client.download(targetOf(args), {
            saveAs: args.saveAs ? str(args.saveAs) : undefined,
            timeout: timeoutOf(args),
          });
          return ok(call.name, `Downloaded ${r.filename} (${r.sizeBytes} bytes) to ${r.path}.`, r);
        }
        case "browser_wait_for": {
          await client.waitFor(targetOf(args), { timeout: timeoutOf(args) });
          return ok(call.name, `Condition met for ${describe(args)}.`, { waited: true });
        }
        default:
          return fail(call.name, `Unknown tool "${call.name}".`);
      }
    } catch (err) {
      return fromError(call.name, err);
    }
  };
}

// ---- helpers ---------------------------------------------------------------

function normalizeArgs(a: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof a === "string") {
    try {
      return a.trim() ? (JSON.parse(a) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return a ?? {};
}

function targetOf(args: Record<string, unknown>) {
  const target = str(args.target);
  return bool(args.ai) ? ai(target) : target;
}

function describe(args: Record<string, unknown>): string {
  return bool(args.ai) ? `ai:"${str(args.target)}"` : str(args.target);
}

function timeoutOf(args: Record<string, unknown>): number | undefined {
  return args.timeoutMs != null ? num(args.timeoutMs) : undefined;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function bool(v: unknown): boolean {
  return v === true || v === "true";
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatObservations(obs: Observation[]): string {
  if (obs.length === 0) return "(no interactive elements found)";
  return obs
    .slice(0, 50)
    .map((o) => `- ${o.role} ${o.selector}${o.name ? ` — "${o.name}"` : ""}`)
    .join("\n");
}

function ok(name: string, content: string, data?: unknown): DispatchResult {
  return { name, ok: true, content, data };
}
function fail(name: string, content: string): DispatchResult {
  return { name, ok: false, content };
}
function fromError(name: string, err: unknown): DispatchResult {
  if (err instanceof ComputerError) {
    const bits = [`Error: ${err.message.split("\n")[0]}`];
    if (err.found) bits.push(`found: ${err.found}`);
    if (err.suggestion) bits.push(`hint: ${err.suggestion}`);
    return {
      name,
      ok: false,
      content: bits.join(" "),
      error: { suggestion: err.suggestion, found: err.found },
    };
  }
  return { name, ok: false, content: `Error: ${err instanceof Error ? err.message : String(err)}` };
}

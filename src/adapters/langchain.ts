/**
 * LangChain adapter (Phase 7) — one LangChain tool per primitive, backed by the
 * Phase 6 dispatcher. Import from "computer-sdk/langchain".
 *
 *   import { ComputerClient } from "computer-sdk";
 *   import { createComputerToolkit } from "computer-sdk/langchain";
 *
 *   const computer = new ComputerClient();
 *   const tools = createComputerToolkit(computer);
 *   // ...hand `tools` to a LangChain agent.
 *
 * Requires the optional peer deps @langchain/core and zod.
 */
import { BaseToolkit, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { computerToolSchemas, createDispatcher } from "./tools-json.js";
import type { ComputerClient } from "../client.js";

/** Zod schemas mirroring each tool's JSON-Schema parameters. */
const SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  browser_goto: z.object({ url: z.string().describe("Absolute URL to open.") }),
  browser_click: z.object({
    target: z.string().describe("CSS selector, or a description if ai=true."),
    ai: z.boolean().optional().describe("Resolve target via the LLM (cached)."),
    timeoutMs: z.number().optional(),
  }),
  browser_type: z.object({
    target: z.string(),
    text: z.string(),
    ai: z.boolean().optional(),
    pressEnter: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  }),
  browser_read: z.object({ selector: z.string().optional() }),
  browser_extract: z.object({
    fields: z.record(z.string()).optional().describe("Map of field -> CSS selector (free path)."),
    instruction: z.string().optional().describe("What to extract (LLM path, cached)."),
  }),
  browser_observe: z.object({
    scope: z.string().optional(),
    instruction: z.string().optional(),
    limit: z.number().optional(),
  }),
  browser_screenshot: z.object({
    selector: z.string().optional(),
    fullPage: z.boolean().optional(),
  }),
  browser_download: z.object({
    target: z.string(),
    ai: z.boolean().optional(),
    saveAs: z.string().optional(),
    timeoutMs: z.number().optional(),
  }),
  browser_wait_for: z.object({
    target: z.string(),
    ai: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  }),
};

/** Build an array of LangChain tools (one per primitive) bound to a client. */
export function createComputerToolkit(client: ComputerClient): DynamicStructuredTool[] {
  const dispatch = createDispatcher(client);
  return computerToolSchemas.map((def) => {
    const schema = SCHEMAS[def.name] ?? z.object({}).passthrough();
    return new DynamicStructuredTool({
      name: def.name,
      description: def.description,
      schema,
      func: async (input: Record<string, unknown>): Promise<string> => {
        const result = await dispatch({ name: def.name, arguments: input });
        return result.content;
      },
    });
  });
}

/** Idiomatic LangChain toolkit wrapper around {@link createComputerToolkit}. */
export class ComputerToolkit extends BaseToolkit {
  override tools: DynamicStructuredTool[];
  constructor(client: ComputerClient) {
    super();
    this.tools = createComputerToolkit(client);
  }
  override getTools(): DynamicStructuredTool[] {
    return this.tools;
  }
}

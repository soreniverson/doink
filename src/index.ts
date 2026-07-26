/**
 * computer-sdk — public entry point.
 *
 *   import { ComputerClient, ai } from "computer-sdk";
 *
 * A plain string is free and deterministic. `ai(...)` is the visible, cached
 * LLM path. Every action is traced. The backend is one config line.
 *
 * NOTE: exports are added phase-by-phase so every commit compiles. Phase 0
 * freezes the types + the ai() wrapper + the error surface.
 */

// The frozen API surface (Phase 0).
export * from "./types.js";

// The ai() wrapper + runtime guards (the whole cost story).
export { ai, isNLTarget, isNLExtract } from "./ai.js";

// Structured, debuggable errors — never a raw Playwright stack trace.
export { ComputerError, ConfigurationError, type ComputerErrorFields } from "./errors.js";

// The frozen client implementation.
export { ComputerClient } from "./client.js";

// Bundle a session's trace into a single shareable HTML bug report.
export { writeTraceReport } from "./trace/report.js";

// The LLM provider factory + client interface. Exposed so you can construct the
// built-in provider and wrap/instrument it (e.g. a call-counting shim) while
// still going through the real resolution path.
export { createLLMClient, type LLMClient } from "./llm/index.js";

// Raw JSON tool-schema adapter (Phase 6) — the most universal integration.
export {
  computerToolSchemas,
  computerTools,
  createDispatcher,
  type ToolSchema,
  type ToolCall,
  type DispatchResult,
  type OpenAITool,
  type AnthropicTool,
} from "./adapters/tools-json.js";

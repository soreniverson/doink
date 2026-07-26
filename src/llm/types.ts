/**
 * The swappable LLM seam. Anthropic and OpenAI are built in; a custom function
 * is accepted so no provider ever blocks you.
 */
import type { LLMResolveInput, LLMResolveOutput } from "../types.js";

export interface LLMClient {
  /** Model id, surfaced in traces. */
  readonly model: string;
  /** Resolve an NL instruction into selector(s) (or data), for a page snapshot. */
  resolve(input: LLMResolveInput): Promise<LLMResolveOutput>;
}

export type { LLMResolveInput, LLMResolveOutput };

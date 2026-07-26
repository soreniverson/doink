/**
 * A resolution turns a target (selector string or ai() instruction) into a
 * concrete Playwright locator, plus the metadata every ActionResult reports.
 */
import type { Locator } from "playwright";
import type { ResolvedTarget } from "../types.js";

export interface Resolution {
  locator: Locator;
  resolved: ResolvedTarget;
  /** True only on a cache-miss LLM resolution. */
  resolvedByLLM: boolean;
  /** True if an ai() call was served from cache (free). */
  cached: boolean;
}

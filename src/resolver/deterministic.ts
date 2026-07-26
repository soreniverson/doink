/**
 * DeterministicResolver — a plain string becomes a Playwright locator directly.
 * Zero cost, zero network, zero tokens. This is rule #1 made literal.
 */
import type { Page } from "playwright";
import type { Resolution } from "./types.js";

export function resolveDeterministic(page: Page, selector: string, nth?: number): Resolution {
  let locator = page.locator(selector);
  if (nth !== undefined) locator = locator.nth(nth);
  return {
    locator,
    resolved: { selector, kind: "selector" },
    resolvedByLLM: false,
    cached: false,
  };
}

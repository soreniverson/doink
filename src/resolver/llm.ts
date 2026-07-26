/**
 * LLMResolver — the actual product.
 *
 * For an ai(...) target it:
 *   1. Computes a page signature (from the snapshot the client provides).
 *   2. Checks the cache. Hit + the cached selector still resolves -> FREE replay.
 *   3. Miss (or a stale cached selector) -> one LLM call, validate, cache it.
 *      A stale cached selector self-heals: re-resolve once and overwrite.
 *
 * Everything the model returns is a SELECTOR (locate), a field->selector map
 * (extract), or a selector list (observe) — all cached and replayed for free.
 */
import type { Page } from "playwright";
import { describeSelectors } from "../dom/interactive.js";
import type { LLMClient } from "../llm/types.js";
import type { NLExtract, NLTarget, Observation, ResolvedTarget } from "../types.js";
import { ResolutionCache, normalizeText, type CacheValue } from "./cache.js";
import type { Resolution } from "./types.js";

/** A compact page snapshot + its structural signature, provided by the client. */
export interface PageSnapshot {
  url: string;
  snapshot: string;
  signature: string;
  /** Lazy: captured only when an actual LLM call happens (never on cache hits). */
  screenshot?: () => Promise<Buffer | undefined>;
}

export type SnapshotFn = () => Promise<PageSnapshot>;

export interface ExtractResolution {
  data: unknown;
  resolvedByLLM: boolean;
  cached: boolean;
  selectorMap?: Record<string, string>;
}

export interface ObserveResolution {
  observations: Observation[];
  resolvedByLLM: boolean;
  cached: boolean;
}

export class LLMResolver {
  constructor(
    private readonly client: LLMClient,
    private readonly cache?: ResolutionCache,
  ) {}

  // ---- locate (click / type / download / waitFor) -----------------------

  async resolveLocate(
    page: Page,
    target: NLTarget,
    getSnapshot: SnapshotFn,
    nth?: number,
  ): Promise<Resolution> {
    const key = `locate:${target.instruction}`;
    const snap = await getSnapshot();

    const cached = await this.cache?.get(snap.signature, key);
    if (cached?.selector && (await this.cachedSelectorValid(page, cached))) {
      return locateResult(page, cached.selector, target.instruction, nth, false, true);
    }
    // Cache miss, or a stale cached selector (gone, or a positional path that now
    // points at the wrong element) -> self-heal with a fresh resolution.

    const out = await this.client.resolve({
      kind: "locate",
      instruction: target.instruction,
      url: snap.url,
      snapshot: snap.snapshot,
      screenshot: await snap.screenshot?.(),
    });
    const selector = out.selector;
    if (!selector) {
      throw new Error(`The LLM returned no selector for: "${target.instruction}"`);
    }
    if (!(await matches(page, selector))) {
      throw new Error(
        `The LLM-resolved selector '${selector}' did not match any element on ${snap.url}`,
      );
    }
    const fingerprint = await this.fingerprint(page, selector);
    await this.cache?.set(snap.signature, key, { selector, fingerprint });
    return locateResult(page, selector, target.instruction, nth, true, false);
  }

  /**
   * A cached selector is valid if it still resolves AND — for fragile positional
   * paths — still points at an element with the same accessible-name/text
   * fingerprint. This is the under-sensitivity guard: it catches a positional
   * selector that now lands on a DIFFERENT element (silent wrong action) and
   * treats it as stale, without spending an LLM call unless it's actually stale.
   */
  private async cachedSelectorValid(page: Page, cached: CacheValue): Promise<boolean> {
    const selector = cached.selector;
    if (!selector || !(await matches(page, selector))) return false;
    if (isPositional(selector) && cached.fingerprint) {
      const fp = await this.fingerprint(page, selector);
      if (fp && fp !== cached.fingerprint) return false; // points somewhere else now
    }
    return true;
  }

  private async fingerprint(page: Page, selector: string): Promise<string | undefined> {
    try {
      const [obs] = await describeSelectors(page, [selector]);
      const raw = obs?.name ?? obs?.text;
      return raw ? normalizeText(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  // ---- extract ----------------------------------------------------------

  async resolveExtract<T>(
    page: Page,
    target: NLExtract<T>,
    getSnapshot: SnapshotFn,
  ): Promise<ExtractResolution> {
    const key = `extract:${target.instruction}`;
    const snap = await getSnapshot();

    const cached = await this.cache?.get(snap.signature, key);
    if (cached?.selectorMap) {
      const data = await extractWithMap(page, cached.selectorMap);
      if (hasAnyValue(data)) {
        return { data, resolvedByLLM: false, cached: true, selectorMap: cached.selectorMap };
      }
      // Stale -> self-heal.
    }

    const out = await this.client.resolve({
      kind: "extract",
      instruction: target.instruction,
      url: snap.url,
      snapshot: snap.snapshot,
      screenshot: await snap.screenshot?.(),
      jsonSchema: target.schema.jsonSchema,
    });

    if (out.selectorMap && Object.keys(out.selectorMap).length > 0) {
      const data = await extractWithMap(page, out.selectorMap);
      await this.cache?.set(snap.signature, key, { selectorMap: out.selectorMap });
      return { data, resolvedByLLM: true, cached: false, selectorMap: out.selectorMap };
    }
    // Model returned data directly — usable, but not cacheable as selectors.
    return { data: out.data ?? {}, resolvedByLLM: true, cached: false };
  }

  // ---- observe ----------------------------------------------------------

  async resolveObserve(
    page: Page,
    target: NLTarget,
    getSnapshot: SnapshotFn,
  ): Promise<ObserveResolution> {
    const key = `observe:${target.instruction}`;
    const snap = await getSnapshot();

    const cached = await this.cache?.get(snap.signature, key);
    if (cached?.selectors) {
      // A legitimately-empty result is a valid, cacheable answer — return it
      // for free rather than re-resolving forever (an empty [] is truthy).
      if (cached.selectors.length === 0) {
        return { observations: [], resolvedByLLM: false, cached: true };
      }
      const observations = await describeSelectors(page, cached.selectors);
      if (observations.length > 0) {
        return { observations, resolvedByLLM: false, cached: true };
      }
      // The cached selectors no longer resolve -> self-heal.
    }

    const out = await this.client.resolve({
      kind: "observe",
      instruction: target.instruction,
      url: snap.url,
      snapshot: snap.snapshot,
      screenshot: await snap.screenshot?.(),
    });
    const selectors = out.selectors ?? [];
    await this.cache?.set(snap.signature, key, { selectors });
    const observations = await describeSelectors(page, selectors);
    return { observations, resolvedByLLM: true, cached: false };
  }

  // ---- waitFor (NL) -----------------------------------------------------

  /**
   * Wait for an ai(...) condition. Unlike a one-shot locate, this must be able
   * to wait for an element that isn't in the DOM yet — so it resolves to a
   * candidate selector ONCE (cached, or a single LLM call) and then hands off to
   * Playwright's native waitFor, which polls the live page until the element
   * appears (free). It does NOT require the element to be present at call time.
   */
  async resolveWait(
    page: Page,
    target: NLTarget,
    getSnapshot: SnapshotFn,
    opts: {
      timeout: number;
      state: "attached" | "detached" | "visible" | "hidden";
      pollInterval: number;
    },
  ): Promise<{ selector: string; resolvedByLLM: boolean; cached: boolean }> {
    const key = `locate:${target.instruction}`;
    const snap = await getSnapshot();

    const cached = await this.cache?.get(snap.signature, key);
    if (cached?.selector) {
      await page
        .locator(cached.selector)
        .first()
        .waitFor({ state: opts.state, timeout: opts.timeout });
      return { selector: cached.selector, resolvedByLLM: false, cached: true };
    }

    const out = await this.client.resolve({
      kind: "locate",
      instruction: target.instruction,
      url: snap.url,
      snapshot: snap.snapshot,
      screenshot: await snap.screenshot?.(),
    });
    if (!out.selector) {
      throw new Error(`waitFor(ai("${target.instruction}")): the LLM returned no selector`);
    }
    // Poll the live page for it to appear/satisfy the state.
    await page.locator(out.selector).first().waitFor({ state: opts.state, timeout: opts.timeout });
    // Cache only now that we know it's a good selector for this page.
    await this.cache?.set(snap.signature, key, { selector: out.selector });
    return { selector: out.selector, resolvedByLLM: true, cached: false };
  }
}

// ---- helpers --------------------------------------------------------------

async function matches(page: Page, selector: string): Promise<boolean> {
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return false;
  }
}

/** A deep positional/structural selector that could silently drift to a sibling. */
function isPositional(selector: string): boolean {
  if (/:nth-(of-type|child)/.test(selector)) return true;
  return (selector.match(/>/g)?.length ?? 0) >= 3;
}

function locateResult(
  page: Page,
  selector: string,
  instruction: string,
  nth: number | undefined,
  resolvedByLLM: boolean,
  cached: boolean,
): Resolution {
  let locator = page.locator(selector);
  if (nth !== undefined) locator = locator.nth(nth);
  const resolved: ResolvedTarget = { selector, kind: "llm-resolved", description: instruction };
  return { locator, resolved, resolvedByLLM, cached };
}

async function extractWithMap(
  page: Page,
  map: Record<string, string>,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [field, selector] of Object.entries(map)) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) === 0) {
        out[field] = null;
        continue;
      }
      const raw = await loc.textContent();
      out[field] = raw == null ? null : raw.trim();
    } catch {
      out[field] = null;
    }
  }
  return out;
}

function hasAnyValue(data: Record<string, string | null>): boolean {
  return Object.values(data).some((v) => v != null);
}

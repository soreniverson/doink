/**
 * Validation harness core — a DIAGNOSTIC, not a test suite.
 *
 * Every action is wrapped so it can NEVER throw and stop the run. A crash on one
 * site or action is caught, categorized, and recorded; the harness marches on.
 *
 * Imports the SDK the way a real consumer would — from the built dist entry.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ComputerClient,
  ComputerError,
  ai,
  createLLMClient,
  type LLMClient,
} from "../dist/index.js";

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(HARNESS_DIR, "results");
export const CACHE_DIR = path.join(RESULTS_DIR, "caches");
export const TRACE_ROOT = path.join(RESULTS_DIR, "traces");

export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type Verdict =
  | "DETERMINISTIC"
  | "LLM_RESOLVED"
  | "CACHED"
  | "DETERMINISTIC_FALLBACK"
  | "SKIPPED"
  | "NAV"
  | "PROBE";

export interface ActionRecord {
  site: string;
  url: string;
  run: 1 | 2;
  seq: number;
  action: string;
  targetKind: "selector" | "ai" | "none";
  target: string;
  outcome: "ok" | "failed" | "skipped";
  durationMs: number;
  verdict: Verdict;
  sdkResolvedByLLM?: boolean;
  sdkCached?: boolean;
  /** Ground-truth model calls during this action (counter delta). */
  llmDelta: number;
  resolvedSelector?: string;
  /** Cross-check: does the SDK's self-report match the counter? */
  flag?: string;
  stale?: "OK" | "POSSIBLE_STALE_HIT" | "N/A";
  note?: string;
  error?: {
    name: string;
    message: string;
    suggestion?: string;
    found?: string;
    /** First line of the underlying (Playwright) cause — the ground truth. */
    rawCause?: string;
    /** Set when the SDK's rendered message contradicts the real cause. */
    mislabeled?: string;
    screenshotPath?: string;
    tracePath?: string;
  };
}

/** A call-counting wrapper around the real built-in provider (ground truth). */
export interface LLMHarness {
  enabled: boolean;
  count(): number;
  /** llm config to hand ComputerClient, or undefined when no key. */
  config?: { provider: (input: unknown) => Promise<unknown> };
  model?: string;
}

export function makeLLM(): LLMHarness {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.COMPUTER_SDK_MODEL || undefined;
  if (!apiKey) return { enabled: false, count: () => 0 };
  const inner: LLMClient = createLLMClient({ provider: "anthropic", apiKey, model });
  let n = 0;
  const provider = async (input: unknown) => {
    n += 1;
    return inner.resolve(input as Parameters<LLMClient["resolve"]>[0]);
  };
  return { enabled: true, count: () => n, model: inner.model, config: { provider } };
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

export interface SiteSpec {
  id: number;
  group: string;
  name: string;
  url: string;
  probes: string;
  /** The action script; run verbatim on both run 1 and run 2. */
  run: (r: SiteRunner) => Promise<void>;
}

/**
 * SiteRunner — the safe action surface handed to each site script. Every method
 * records an ActionRecord and returns it; NONE of them throw.
 */
export class SiteRunner {
  seq = 0;
  constructor(
    private readonly client: ComputerClient,
    private readonly llm: LLMHarness,
    readonly ctx: {
      site: string;
      url: string;
      run: 1 | 2;
      records: ActionRecord[];
      timeout: number;
    },
  ) {}

  private base(action: string, targetKind: ActionRecord["targetKind"], target: string): ActionRecord {
    return {
      site: this.ctx.site,
      url: this.ctx.url,
      run: this.ctx.run,
      seq: this.seq++,
      action,
      targetKind,
      target,
      outcome: "ok",
      durationMs: 0,
      verdict: "DETERMINISTIC",
      llmDelta: 0,
    };
  }

  private push(rec: ActionRecord): ActionRecord {
    this.ctx.records.push(rec);
    return rec;
  }

  private async capture(err: unknown): Promise<ActionRecord["error"]> {
    if (err instanceof ComputerError) {
      const rawCause = firstLineOf((err.cause as Error | undefined)?.message);
      const e: NonNullable<ActionRecord["error"]> = {
        name: err.name,
        message: err.message,
        suggestion: err.suggestion,
        found: err.found,
        rawCause,
        screenshotPath: relTrace(err.screenshotPath),
        tracePath: relTrace(err.tracePath),
      };
      // Cross-check the SDK's OWN rendered message against the real cause. On a
      // strict-mode violation the selector matched MANY elements, but the SDK
      // says "no element matched" / "0 matched" — a misleading diagnosis on the
      // single most common real-world selector situation.
      if (/strict mode violation/i.test(rawCause ?? "") && /no element matched|0 matched/i.test(err.message)) {
        const n = rawCause?.match(/resolved to (\d+) element/i)?.[1] ?? "multiple";
        e.mislabeled = `SDK says "no element matched" but ${n} elements DID match (strict-mode violation)`;
      }
      return e;
    }
    const e = err as Error;
    return { name: e?.name ?? "Error", message: String(e?.message ?? err) };
  }

  async goto(url: string): Promise<ActionRecord> {
    const rec = this.base("goto", "none", url);
    rec.verdict = "NAV";
    const t0 = now();
    try {
      const nav = await this.client.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      rec.durationMs = Math.round(now() - t0);
      rec.note = `status ${nav.status ?? "?"} -> ${nav.url}`;
      // A 4xx/5xx landing is a crack for the flow — and notably the SDK's goto
      // does NOT surface non-2xx as an error, so record it loudly here.
      if (typeof nav.status === "number" && nav.status >= 400) {
        rec.outcome = "failed";
        rec.error = {
          name: "HttpStatus",
          message: `navigation returned HTTP ${nav.status} (SDK goto does not treat non-2xx as an error)`,
        };
      }
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  /** Deterministic action wrapper (click/type/waitFor with a selector). */
  private async det(
    action: string,
    target: string,
    fn: () => Promise<{ resolvedByLLM: boolean; cached: boolean; target: { selector: string } } | void>,
  ): Promise<ActionRecord> {
    const rec = this.base(action, "selector", target);
    const before = this.llm.count();
    const t0 = now();
    try {
      const res = await fn();
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      if (res && "resolvedByLLM" in res) {
        rec.sdkResolvedByLLM = res.resolvedByLLM;
        rec.sdkCached = res.cached;
        rec.resolvedSelector = res.target.selector;
      }
      rec.verdict = "DETERMINISTIC";
      if (rec.llmDelta !== 0) rec.flag = `deterministic action spent ${rec.llmDelta} LLM call(s)!`;
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  click(selector: string): Promise<ActionRecord> {
    return this.det("click", selector, () =>
      this.client.click(selector, { timeout: this.ctx.timeout }),
    );
  }

  type(selector: string, text: string, opts: { pressEnter?: boolean } = {}): Promise<ActionRecord> {
    return this.det("type", selector, () =>
      this.client.type(selector, text, { timeout: this.ctx.timeout, pressEnter: opts.pressEnter }),
    );
  }

  waitFor(selector: string): Promise<ActionRecord> {
    return this.det("waitFor", selector, () =>
      this.client.waitFor(selector, { timeout: this.ctx.timeout }),
    );
  }

  /** Deterministic extract via a selector map. */
  async extract(map: Record<string, string>, label = Object.keys(map).join(",")): Promise<ActionRecord> {
    const rec = this.base("extract", "selector", label);
    const before = this.llm.count();
    const t0 = now();
    try {
      const data = await this.client.extract<Record<string, string | null>>(map, {
        timeout: this.ctx.timeout,
      });
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      const nonNull = Object.values(data).filter((v) => v != null).length;
      rec.note = `${nonNull}/${Object.keys(map).length} fields -> ${sample(data)}`;
      if (nonNull === 0) {
        rec.outcome = "failed";
        rec.error = { name: "EmptyExtract", message: "every selector in the map matched nothing" };
      }
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  /** Deterministic observe (heuristic scan). */
  async observe(scope?: string): Promise<ActionRecord> {
    const rec = this.base("observe", scope ? "selector" : "none", scope ?? "<all>");
    const t0 = now();
    try {
      const obs = await this.client.observe(scope);
      rec.durationMs = Math.round(now() - t0);
      rec.note = `${obs.length} interactive elements`;
      if (obs.length === 0) {
        rec.outcome = "failed";
        rec.error = {
          name: "EmptyObserve",
          message: "observe found 0 interactive elements — page likely bot-walled, a challenge, or an empty shell",
        };
      } else if (obs.length <= 3) {
        rec.note += " (suspiciously few — possible bot-wall / challenge page)";
      }
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  // ---- ai(...) paths — SKIPPED when no key ------------------------------

  private skipped(action: string, target: string): ActionRecord {
    const rec = this.base(action, "ai", target);
    rec.outcome = "skipped";
    rec.verdict = "SKIPPED";
    rec.note = "no ANTHROPIC_API_KEY";
    return this.push(rec);
  }

  private aiVerdict(rec: ActionRecord, res: { resolvedByLLM: boolean; cached: boolean }): void {
    rec.sdkResolvedByLLM = res.resolvedByLLM;
    rec.sdkCached = res.cached;
    if (res.cached) rec.verdict = "CACHED";
    else if (res.resolvedByLLM) rec.verdict = "LLM_RESOLVED";
    else rec.verdict = "DETERMINISTIC_FALLBACK";
    // Ground-truth cross-check against the SDK's self-report.
    if (rec.verdict === "CACHED" && rec.llmDelta > 0) {
      rec.flag = `SDK reported CACHED but ${rec.llmDelta} model call(s) happened (cache leak)`;
    }
    if (rec.verdict === "LLM_RESOLVED" && rec.llmDelta === 0) {
      rec.flag = "SDK reported LLM_RESOLVED but the counter saw 0 calls";
    }
  }

  async clickAI(instruction: string): Promise<ActionRecord> {
    if (!this.llm.enabled) return this.skipped("clickAI", instruction);
    const rec = this.base("clickAI", "ai", instruction);
    const before = this.llm.count();
    const t0 = now();
    try {
      const res = await this.client.click(ai(instruction), { timeout: this.ctx.timeout });
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.resolvedSelector = res.target.selector;
      this.aiVerdict(rec, res);
      await this.stalenessProbe(rec);
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.verdict = rec.llmDelta > 0 ? "LLM_RESOLVED" : "DETERMINISTIC_FALLBACK";
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  async waitForAI(instruction: string): Promise<ActionRecord> {
    if (!this.llm.enabled) return this.skipped("waitForAI", instruction);
    const rec = this.base("waitForAI", "ai", instruction);
    const before = this.llm.count();
    const t0 = now();
    try {
      await this.client.waitFor(ai(instruction), { timeout: this.ctx.timeout });
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.verdict = rec.llmDelta > 0 ? "LLM_RESOLVED" : "CACHED";
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  async extractAI(instruction: string): Promise<ActionRecord> {
    if (!this.llm.enabled) return this.skipped("extractAI", instruction);
    const rec = this.base("extractAI", "ai", instruction);
    const before = this.llm.count();
    const t0 = now();
    try {
      const data = await this.client.extract(
        ai({ schema: { parse: (x: unknown) => x }, instruction }),
        { timeout: this.ctx.timeout },
      );
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.note = sample(data);
      // extract self-report is derived from llmDelta (SDK doesn't return flags on extract<T>).
      rec.verdict = rec.llmDelta > 0 ? "LLM_RESOLVED" : "CACHED";
    } catch (err) {
      rec.outcome = "failed";
      rec.durationMs = Math.round(now() - t0);
      rec.llmDelta = this.llm.count() - before;
      rec.error = await this.capture(err);
    }
    return this.push(rec);
  }

  /** Deliberate wrong selector — expects failure, captures the "did you mean" hint. */
  async wrongSelector(selector: string): Promise<ActionRecord> {
    const rec = this.base("wrongSelectorProbe", "selector", selector);
    rec.verdict = "PROBE";
    const t0 = now();
    try {
      await this.client.click(selector, { timeout: 4000 });
      rec.durationMs = Math.round(now() - t0);
      rec.outcome = "failed";
      rec.note = "UNEXPECTED: the wrong selector actually matched something";
    } catch (err) {
      rec.durationMs = Math.round(now() - t0);
      // Expected: this SHOULD throw a ComputerError with a hint.
      rec.error = await this.capture(err);
      rec.note = rec.error?.suggestion
        ? `hint present: ${rec.error.suggestion}`
        : "NO HINT surfaced on this real DOM";
    }
    return this.push(rec);
  }

  /** For a CACHED run-2 ai action, verify the cached selector still resolves. */
  private async stalenessProbe(rec: ActionRecord): Promise<void> {
    if (this.ctx.run !== 2 || rec.verdict !== "CACHED" || !rec.resolvedSelector) {
      rec.stale = "N/A";
      return;
    }
    try {
      const probe = await this.client.extract<{ __p: string | null }>({ __p: rec.resolvedSelector });
      rec.stale = probe.__p == null ? "POSSIBLE_STALE_HIT" : "OK";
      if (rec.stale === "POSSIBLE_STALE_HIT") {
        rec.flag = "cached selector served on run 2 no longer resolves";
      }
    } catch {
      rec.stale = "POSSIBLE_STALE_HIT";
    }
  }
}

// ---- driving a single site (run twice) ------------------------------------

export interface SiteResult {
  spec: { id: number; group: string; name: string; url: string; probes: string };
  run1: ActionRecord[];
  run2: ActionRecord[];
  llmRun1: number;
  llmRun2: number;
  verdict: "PASS" | "DEGRADED" | "BROKE" | "SKIPPED_LLM";
  cacheFileBefore?: unknown;
  cacheFileAfter?: unknown;
  fatal?: string;
}

export async function runSite(spec: SiteSpec, llm: LLMHarness): Promise<SiteResult> {
  const s = slug(`${spec.id}-${spec.name}`);
  const cachePath = path.join(CACHE_DIR, `${s}.json`);
  const traceDir = path.join(TRACE_ROOT, s);
  await fs.rm(cachePath, { force: true }).catch(() => {});

  const records: ActionRecord[] = [];
  const result: SiteResult = {
    spec: { id: spec.id, group: spec.group, name: spec.name, url: spec.url, probes: spec.probes },
    run1: [],
    run2: [],
    llmRun1: 0,
    llmRun2: 0,
    verdict: "PASS",
  };

  // Run 1 and run 2 use SEPARATE clients (fresh browser context each, so no
  // cookie/auth carryover) but SHARE the cache file — this is the real
  // "commit the cache, free reruns on a clean machine" scenario, and it keeps
  // the cache measurement honest instead of contaminated by login state.
  const makeClient = (run: 1 | 2) =>
    new ComputerClient({
      backend: { headless: true, args: [`--user-agent=${DESKTOP_UA}`, "--window-size=1440,900"] },
      llm: llm.config as never,
      cache: { path: cachePath },
      trace: { dir: path.join(traceDir, `run${run}`) },
      defaultTimeout: 20_000,
    });

  try {
    const client1 = makeClient(1);
    const before1 = llm.count();
    const r1 = new SiteRunner(client1, llm, { site: spec.name, url: spec.url, run: 1, records, timeout: 20_000 });
    await safe(() => spec.run(r1));
    result.llmRun1 = llm.count() - before1;
    await safe(() => client1.close());
    result.cacheFileBefore = await readJsonSafe(cachePath);

    const client2 = makeClient(2);
    const before2 = llm.count();
    const r2 = new SiteRunner(client2, llm, { site: spec.name, url: spec.url, run: 2, records, timeout: 20_000 });
    await safe(() => spec.run(r2));
    result.llmRun2 = llm.count() - before2;
    await safe(() => client2.close());
    result.cacheFileAfter = await readJsonSafe(cachePath);
  } catch (err) {
    result.fatal = String((err as Error)?.message ?? err);
  }

  result.run1 = records.filter((r) => r.run === 1);
  result.run2 = records.filter((r) => r.run === 2);
  result.verdict = judge(result, llm);
  return result;
}

function judge(r: SiteResult, llm: LLMHarness): SiteResult["verdict"] {
  const all = [...r.run1, ...r.run2];
  const real = all.filter((a) => a.outcome !== "skipped" && a.action !== "wrongSelectorProbe");
  if (real.length === 0) return "BROKE";
  const failed = real.filter((a) => a.outcome === "failed");
  const gotoFailed = real.some((a) => a.action === "goto" && a.outcome === "failed");
  const cacheLeak = r.run2.some((a) => a.flag?.includes("cache leak"));
  if (gotoFailed || failed.length === real.length) return "BROKE";
  if (failed.length > 0 || cacheLeak) return "DEGRADED";
  return "PASS";
}

// ---- small utils ----------------------------------------------------------

function now(): number {
  return performance.now();
}

async function safe(fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* diagnostic harness — swallow, the record already captured it */
  }
}

async function readJsonSafe(p: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return undefined;
  }
}

function relTrace(p?: string): string | undefined {
  if (!p) return undefined;
  return path.relative(RESULTS_DIR, p);
}

function firstLineOf(s?: string): string | undefined {
  if (!s) return undefined;
  return s.split("\n")[0]?.trim();
}

function sample(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return String(data);
  }
}

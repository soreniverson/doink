/**
 * ComputerClient — the frozen API implementation.
 *
 * Every primitive routes through `op()`, which times the action, records a
 * structured trace entry, and converts any failure into a ComputerError (never
 * a raw Playwright stack). Resolution (`resolve()`) is the seam where a plain
 * string stays free and an ai(...) target opts into the cached LLM path.
 *
 * Built phase-by-phase. This file grows additively:
 *   Phase 1 — the 7 deterministic primitives (this commit).
 *   Phase 2 — "did you mean" hints + DOM excerpts in fail().
 *   Phase 3 — extract + observe.
 *   Phase 4 — the ai(...) LLM path (resolve()'s NL branch).
 *   Phase 5 — the CDP backend branch.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import { isNLExtract, isNLTarget } from "./ai.js";
import { ComputerError, ConfigurationError } from "./errors.js";
import { PlaywrightPageView } from "./page-view.js";
import { buildHint } from "./trace/hints.js";
import { writeTraceReport } from "./trace/report.js";
import { matchedElementsHtml } from "./dom/interactive.js";
import { resolveDeterministic } from "./resolver/deterministic.js";
import { collectObservations } from "./resolver/observe.js";
import { ResolutionCache, pageSignature, stableSkeleton } from "./resolver/cache.js";
import { LLMResolver, type PageSnapshot } from "./resolver/llm.js";
import type { Resolution } from "./resolver/types.js";
import { createLLMClient } from "./llm/index.js";
import { LocalPlaywrightBackend } from "./backend/local.js";
import { CDPBackend } from "./backend/cdp.js";
import type { Backend, BrowserSession } from "./backend/types.js";
import { Tracer, resolveTraceConfig } from "./trace/tracer.js";
import type {
  ActionResult,
  ClickOptions,
  ComputerClient as IComputerClient,
  ComputerClientConfig,
  DownloadOptions,
  DownloadResult,
  ExtractOptions,
  GotoOptions,
  NavigationResult,
  NLExtract,
  NLTarget,
  Observation,
  ObserveOptions,
  PageView,
  ReadOptions,
  ResolvedTarget,
  Schema,
  ScreenshotOptions,
  SelectorMap,
  Trace,
  TypeOptions,
  WaitOptions,
} from "./types.js";

const DEFAULT_TIMEOUT = 15_000;

/** Mutable state threaded through an op() so the trace/error know what happened. */
interface OpCtx {
  elapsed(): number;
  resolved(target: ResolvedTarget, meta?: { resolvedByLLM?: boolean; cached?: boolean }): void;
  note(meta: Record<string, unknown>): void;
}

export class ComputerClient implements IComputerClient {
  private readonly backend: Backend;
  private readonly tracer: Tracer;
  private readonly defaultTimeout: number;
  private readonly throwOnHttpError: boolean;
  private readonly cache?: ResolutionCache;
  private readonly llm?: LLMResolver;

  private session: BrowserSession | null = null;
  private sessionPromise: Promise<BrowserSession> | null = null;
  private closed = false;

  constructor(config: ComputerClientConfig = {}) {
    this.backend = createBackend(config.backend ?? "local");
    this.tracer = new Tracer(resolveTraceConfig(config.trace));
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;
    this.throwOnHttpError = config.throwOnHttpError ?? true;

    if (config.cache !== false) {
      this.cache = new ResolutionCache({
        enabled: config.cache?.enabled ?? true,
        path: config.cache?.path ?? "./.computer-cache.json",
      });
    }
    if (config.llm) {
      this.llm = new LLMResolver(createLLMClient(config.llm), this.cache);
    }
  }

  // ---- lifecycle --------------------------------------------------------

  private async ensure(): Promise<BrowserSession> {
    if (this.closed) throw new ConfigurationError("ComputerClient is closed.");
    if (this.session) return this.session;
    if (!this.sessionPromise) this.sessionPromise = this.backend.launch();

    let session: BrowserSession;
    try {
      session = await this.sessionPromise;
    } catch (err) {
      // Don't cache a rejected launch — a transient failure must be retryable.
      this.sessionPromise = null;
      throw err;
    }

    if (this.closed) {
      // close() was called while the launch was in flight; close() owns tearing
      // the resulting session down, so just refuse rather than hand back a
      // session that's about to be closed.
      throw new ConfigurationError("ComputerClient is closed.");
    }
    this.session = session;
    return session;
  }

  async close(): Promise<void> {
    this.closed = true;
    const session = this.session;
    const pending = this.sessionPromise;
    this.session = null;
    this.sessionPromise = null;
    try {
      // Close the live session, or — if a launch is still in flight — wait for
      // it and close what it produced (otherwise that browser leaks).
      const toClose = session ?? (pending ? await pending : null);
      if (toClose) await toClose.close();
    } catch {
      /* launch failed, or already closed — nothing to clean up */
    }
  }

  trace(): Trace {
    return this.tracer.getTrace();
  }

  /**
   * Bundle this session into a single self-contained HTML report (screenshots
   * embedded) that a tester can open and send as one file. Returns its path.
   *
   *   const report = await computer.bundle();   // -> <traceDir>/report.html
   */
  async bundle(outPath?: string): Promise<string> {
    return writeTraceReport(this.tracer.getTrace(), outPath);
  }

  // ---- primitives -------------------------------------------------------

  async goto(url: string, opts: GotoOptions = {}): Promise<NavigationResult> {
    const { page } = await this.ensure();
    return this.op("goto", url, async (ctx) => {
      const response = await page.goto(url, {
        waitUntil: opts.waitUntil ?? "load",
        timeout: opts.timeout ?? this.defaultTimeout,
        referer: opts.referer,
      });
      const status = response?.status();
      ctx.resolved({ selector: url, kind: "selector" });
      ctx.note({ status });
      // A 4xx/5xx landing is a failed navigation onto an error page — surfacing
      // it here stops it from silently poisoning every subsequent action.
      const throwOnHttp = opts.throwOnHttpError ?? this.throwOnHttpError;
      if (throwOnHttp && typeof status === "number" && status >= 400) {
        throw new HttpStatusSignal(status);
      }
      return {
        ok: true,
        url: page.url(),
        status,
        durationMs: ctx.elapsed(),
      } satisfies NavigationResult;
    });
  }

  async click(target: string | NLTarget, opts: ClickOptions = {}): Promise<ActionResult> {
    const { page } = await this.ensure();
    return this.op("click", describeTarget(target), async (ctx) => {
      const r = await this.resolve(page, target, opts.nth);
      ctx.resolved(r.resolved, r);
      await this.guardSingle(r, opts.nth);
      await r.locator.click({
        timeout: opts.timeout ?? this.defaultTimeout,
        force: opts.force,
        button: opts.button,
        clickCount: opts.clickCount,
      });
      return this.actionResult(r, ctx);
    });
  }

  async type(
    target: string | NLTarget,
    text: string,
    opts: TypeOptions = {},
  ): Promise<ActionResult> {
    const { page } = await this.ensure();
    return this.op("type", describeTarget(target), async (ctx) => {
      const r = await this.resolve(page, target, opts.nth);
      ctx.resolved(r.resolved, r);
      await this.guardSingle(r, opts.nth);
      const timeout = opts.timeout ?? this.defaultTimeout;
      const clear = opts.clear ?? true;
      if (clear && !opts.delay) {
        await r.locator.fill(text, { timeout });
      } else {
        if (clear) await r.locator.fill("", { timeout });
        await r.locator.pressSequentially(text, { timeout, delay: opts.delay });
      }
      if (opts.pressEnter) await r.locator.press("Enter", { timeout });
      ctx.note({ textLength: text.length });
      return this.actionResult(r, ctx);
    });
  }

  async read(opts: ReadOptions = {}): Promise<string> {
    const { page } = await this.ensure();
    return this.op("read", opts.selector ?? "<page>", async (ctx) => {
      const mode = opts.mode ?? "innerText";
      const locator = opts.selector ? page.locator(opts.selector).first() : page.locator("body");
      let text: string;
      if (mode === "textContent") {
        text = (await locator.textContent({ timeout: this.defaultTimeout })) ?? "";
      } else {
        text = await locator.innerText({ timeout: this.defaultTimeout });
      }
      text = text.trim();
      ctx.note({ length: text.length });
      return text;
    });
  }

  async extract<T>(target: SelectorMap | NLExtract<T>, opts: ExtractOptions = {}): Promise<T> {
    const { page } = await this.ensure();
    const desc = isNLExtract(target) ? `ai:"${target.instruction}"` : "<selector-map>";
    return this.op("extract", desc, async (ctx) => {
      if (isNLExtract<T>(target)) {
        const resolver = this.requireLLM("extract");
        const r = await resolver.resolveExtract(page, target, () => this.snapshot(page));
        ctx.resolved(
          { selector: target.instruction, kind: "llm-resolved", description: target.instruction },
          { resolvedByLLM: r.resolvedByLLM, cached: r.cached },
        );
        ctx.note({ fields: Object.keys((r.data ?? {}) as object), selectorMap: r.selectorMap });
        return coerceSchema(target.schema, r.data, (e) =>
          ctx.note({ schemaValidationFailed: e instanceof Error ? e.message : String(e) }),
        );
      }
      // Free path: a selector map { field: "css-selector" }.
      const timeout = opts.timeout ?? this.defaultTimeout;
      const out: Record<string, string | null> = {};
      for (const [field, selector] of Object.entries(target)) {
        const loc = page.locator(selector).first();
        if ((await loc.count()) === 0) {
          out[field] = null;
          continue;
        }
        const raw = await loc.textContent({ timeout });
        out[field] = raw == null ? null : raw.trim();
      }
      ctx.note({ fields: Object.keys(target) });
      return out as T;
    });
  }

  async observe(target?: string | NLTarget, opts: ObserveOptions = {}): Promise<Observation[]> {
    const { page } = await this.ensure();
    const desc =
      target === undefined
        ? "<all>"
        : typeof target === "string"
          ? target
          : `ai:"${target.instruction}"`;
    return this.op("observe", desc, async (ctx) => {
      if (isNLTarget(target)) {
        const resolver = this.requireLLM("observe");
        const r = await resolver.resolveObserve(page, target, () => this.snapshot(page));
        ctx.resolved(
          { selector: target.instruction, kind: "llm-resolved", description: target.instruction },
          { resolvedByLLM: r.resolvedByLLM, cached: r.cached },
        );
        ctx.note({ count: r.observations.length });
        return r.observations;
      }
      const observations = await collectObservations(page, {
        limit: opts.limit ?? 50,
        includeHidden: opts.includeHidden ?? false,
        scopeSelector: typeof target === "string" ? target : undefined,
      });
      ctx.note({ count: observations.length });
      return observations;
    });
  }

  async screenshot(opts: ScreenshotOptions = {}): Promise<Buffer> {
    const { page } = await this.ensure();
    return this.op("screenshot", opts.selector ?? "<page>", async (ctx) => {
      const type = opts.type ?? "png";
      let buffer: Buffer;
      if (opts.selector) {
        buffer = await page.locator(opts.selector).first().screenshot({ type });
      } else {
        buffer = await page.screenshot({ fullPage: opts.fullPage ?? false, type });
      }
      const saved = await this.tracer.saveScreenshot(buffer, "screenshot");
      if (opts.path) {
        await fs.mkdir(path.dirname(path.resolve(opts.path)), { recursive: true });
        await fs.writeFile(opts.path, buffer);
      }
      ctx.note({ path: opts.path ?? saved, bytes: buffer.length });
      return buffer;
    });
  }

  async download(target: string | NLTarget, opts: DownloadOptions = {}): Promise<DownloadResult> {
    const { page } = await this.ensure();
    return this.op("download", describeTarget(target), async (ctx) => {
      const r = await this.resolve(page, target);
      ctx.resolved(r.resolved, r);
      await this.guardSingle(r, undefined);
      const timeout = opts.timeout ?? this.defaultTimeout;
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout }),
        r.locator.click({ timeout }),
      ]);
      const suggested = download.suggestedFilename();
      const dir = opts.dir ?? "./.downloads";
      const savePath = path.resolve(opts.saveAs ?? path.join(dir, suggested));
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      await download.saveAs(savePath);
      const stat = await fs.stat(savePath);
      ctx.note({ path: savePath, bytes: stat.size });
      return {
        ok: true,
        target: r.resolved,
        durationMs: ctx.elapsed(),
        resolvedByLLM: r.resolvedByLLM,
        cached: r.cached,
        path: savePath,
        filename: path.basename(savePath),
        suggestedFilename: suggested,
        sizeBytes: stat.size,
      } satisfies DownloadResult;
    });
  }

  async waitFor(
    condition: string | NLTarget | ((page: PageView) => boolean | Promise<boolean>),
    opts: WaitOptions = {},
  ): Promise<void> {
    const { page } = await this.ensure();
    return this.op("waitFor", describeCondition(condition), async (ctx) => {
      const timeout = opts.timeout ?? this.defaultTimeout;

      if (typeof condition === "string") {
        await page
          .locator(condition)
          .first()
          .waitFor({ state: opts.state ?? "visible", timeout });
        ctx.resolved({ selector: condition, kind: "selector" });
        return;
      }

      if (isNLTarget(condition)) {
        const resolver = this.requireLLM("waitFor");
        // Polls: can wait for an element that isn't in the DOM yet, spending an
        // LLM call only when the page actually changes.
        const r = await resolver.resolveWait(page, condition, () => this.snapshot(page), {
          timeout,
          state: opts.state ?? "visible",
          pollInterval: opts.pollInterval ?? 250,
        });
        ctx.resolved(
          { selector: r.selector, kind: "llm-resolved", description: condition.instruction },
          { resolvedByLLM: r.resolvedByLLM, cached: r.cached },
        );
        return;
      }

      // Predicate function: poll a read-only PageView.
      const predicate = condition as (page: PageView) => boolean | Promise<boolean>;
      ctx.resolved({ selector: "<predicate>", kind: "predicate" });
      const view = new PlaywrightPageView(page);
      const pollInterval = opts.pollInterval ?? 250;
      const deadline = Date.now() + timeout;
      for (;;) {
        if (await predicate(view)) return;
        if (Date.now() >= deadline) {
          throw new Error(`predicate did not become true within ${timeout}ms`);
        }
        await sleep(Math.min(pollInterval, Math.max(0, deadline - Date.now())));
      }
    });
  }

  // ---- internals --------------------------------------------------------

  /** Resolve a target into a locator, keeping the free path free. */
  private async resolve(
    page: Page,
    target: string | NLTarget,
    nth?: number,
  ): Promise<Resolution> {
    if (isNLTarget(target)) {
      const resolver = this.requireLLM("click");
      return resolver.resolveLocate(page, target, () => this.snapshot(page), nth);
    }
    return resolveDeterministic(page, target, nth);
  }

  /** The ai(...) path requires an llm config; otherwise a clear, actionable error. */
  private requireLLM(action: string): LLMResolver {
    if (!this.llm) {
      throw new ConfigurationError(
        `ai(...) was used in ${action}(), but no \`llm\` was configured.\n` +
          `Pass an llm config to the ComputerClient, e.g.\n` +
          `  new ComputerClient({ llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY } })\n` +
          `Deterministic targets (plain selectors) require no llm config and never spend tokens.`,
      );
    }
    return this.llm;
  }

  /** A compact page snapshot + a structural signature, handed to the resolver. */
  private async snapshot(page: Page): Promise<PageSnapshot> {
    const obs = await collectObservations(page, { limit: 150, includeHidden: false });
    const lines = obs.map((o) => `${o.role} "${o.name ?? o.text ?? ""}" -> ${o.selector}`);
    // Signature is hashed from an id/content-STABLE skeleton — NOT the concrete
    // selectors (which contain churning ids) — so the cache still hits across
    // loads on id-churning pages (uitp.dynamicid, HN's per-story vote ids).
    const structural = stableSkeleton(obs);
    return {
      url: page.url(),
      snapshot: lines.join("\n"),
      signature: pageSignature(page.url(), structural),
      // Lazy: only captured if the resolver actually calls the LLM (a cache miss).
      screenshot: async () => {
        try {
          return await page.screenshot({ type: "png" });
        } catch {
          return undefined;
        }
      },
    };
  }

  private actionResult(r: Resolution, ctx: OpCtx): ActionResult {
    return {
      ok: true,
      target: r.resolved,
      durationMs: ctx.elapsed(),
      resolvedByLLM: r.resolvedByLLM,
      cached: r.cached,
    };
  }

  private currentUrl(): string {
    try {
      return this.session?.page.url() ?? "about:blank";
    } catch {
      return "about:blank";
    }
  }

  private async safeTitle(): Promise<string> {
    try {
      return (await this.session?.page.title()) ?? "";
    } catch {
      return "";
    }
  }

  /**
   * The universal action wrapper: time it, trace it, and (Phase 2) turn any
   * failure into a ComputerError with a screenshot + DOM excerpt + hint.
   */
  private async op<R>(
    action: string,
    target: string,
    body: (ctx: OpCtx) => Promise<R>,
  ): Promise<R> {
    const started = performance.now();
    const state: {
      selector?: string;
      resolvedByLLM: boolean;
      cached: boolean;
      meta?: Record<string, unknown>;
    } = { resolvedByLLM: false, cached: false };

    const ctx: OpCtx = {
      elapsed: () => Math.round(performance.now() - started),
      resolved: (t, meta) => {
        state.selector = t.selector;
        if (meta) {
          state.resolvedByLLM = meta.resolvedByLLM ?? false;
          state.cached = meta.cached ?? false;
        }
      },
      note: (meta) => {
        state.meta = { ...state.meta, ...meta };
      },
    };

    try {
      const value = await body(ctx);
      await this.tracer.record({
        action,
        target,
        ok: true,
        durationMs: ctx.elapsed(),
        resolvedByLLM: state.resolvedByLLM,
        cached: state.cached,
        resolvedSelector: state.selector,
        meta: state.meta,
        pageUrl: this.currentUrl(),
        pageTitle: await this.safeTitle(),
      });
      return value;
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      if (err instanceof ComputerError) throw err;
      throw await this.fail(action, target, err, ctx.elapsed(), state.selector);
    }
  }

  /**
   * Refuse to act ambiguously: if a target resolves to more than one element and
   * the caller didn't pick one via `nth`, fail fast with the true count instead
   * of letting Playwright's strict-mode violation get mislabeled downstream.
   */
  private async guardSingle(r: Resolution, nth: number | undefined): Promise<void> {
    if (nth !== undefined) return; // caller chose a specific match
    let count: number;
    try {
      count = await r.locator.count();
    } catch {
      return; // let the action run and fail naturally
    }
    if (count > 1) throw new MultiMatchSignal(r.resolved.selector, count);
  }

  /**
   * Build the truthful failure report + record the failed trace entry. Tells
   * apart the three ways acting on a target fails — 0 matched, N>1 matched
   * (ambiguous), or 1 matched but not actionable — and renders each honestly.
   */
  private async fail(
    action: string,
    target: string,
    cause: unknown,
    durationMs: number,
    resolvedSelector?: string,
  ): Promise<ComputerError> {
    const page = this.session?.page;
    const pageUrl = this.currentUrl();
    const pageTitle = await this.safeTitle();
    const status = cause instanceof HttpStatusSignal ? cause.status : undefined;
    const acting =
      status === undefined && (action === "click" || action === "type" || action === "download");

    // The concrete selector we acted on (for deterministic it's the target).
    const selector =
      (cause instanceof MultiMatchSignal ? cause.selector : undefined) ??
      (isPlainSelector(target) ? target : resolvedSelector);

    let screenshotPath: string | undefined;
    let suggestion: string | undefined;
    let found: string | undefined;
    let domExcerpt: string | undefined;
    let matched: number | undefined =
      cause instanceof MultiMatchSignal ? cause.count : strictModeCount(cause);
    let reason: string | undefined;
    let fix: string | undefined;

    if (page) {
      if (this.tracer.config.screenshotOnFailure) {
        try {
          const buf = await page.screenshot({ type: "png" });
          screenshotPath = await this.tracer.saveScreenshot(buf, `${action}-fail`);
        } catch {
          /* best effort */
        }
      }
      if (status === undefined) {
        try {
          const hint = await buildHint(page, action, target, {
            captureDom: this.tracer.config.captureDomOnFailure,
          });
          suggestion = hint.suggestion;
          found = hint.found;
          domExcerpt = hint.domExcerpt;
          if (acting && matched === undefined) matched = hint.matchCount;
        } catch {
          /* best effort — a hint is a bonus, never a failure mode */
        }
      }

      // Case (b): the selector matched MULTIPLE elements — render the truth.
      if (acting && matched !== undefined && matched > 1 && selector) {
        try {
          const m = await matchedElementsHtml(page, selector, 3);
          if (m.count > 0) matched = m.count;
          if (m.html.length > 0) domExcerpt = m.html.join("\n");
        } catch {
          /* keep the count we have */
        }
        found = undefined; // the "matched: N" line replaces "found:"
        suggestion = undefined; // the selector isn't wrong, just ambiguous
        fix = "narrow the selector, or pass { nth: 0 } to act on a specific match";
      } else if (acting && matched === 1) {
        // Case (c): matched exactly one element but couldn't act on it.
        reason = actionabilityReason(cause);
        suggestion = undefined; // the selector is right; don't suggest another
      }
    }

    if (domExcerpt) {
      await this.tracer.saveText(`${action}-dom.txt`, domExcerpt);
    }

    const error = new ComputerError({
      action,
      target,
      pageUrl,
      pageTitle,
      screenshotPath,
      suggestion,
      found,
      matched: acting ? matched : undefined,
      reason,
      fix,
      status,
      domExcerpt,
      tracePath: this.tracer.tracePath,
      cause,
    });

    await this.tracer.record({
      action,
      target,
      ok: false,
      durationMs,
      pageUrl,
      pageTitle,
      screenshotPath,
      error: {
        message: firstLine(error.message),
        rendered: error.message,
        suggestion: suggestion ?? fix,
        domExcerpt,
      },
    });

    return error;
  }
}

// ---- module-local helpers -------------------------------------------------

function createBackend(config: NonNullable<ComputerClientConfig["backend"]>): Backend {
  if (config === "local") return new LocalPlaywrightBackend();
  if (typeof config === "object" && "cdpUrl" in config) return new CDPBackend(config);
  return new LocalPlaywrightBackend(config);
}

function describeTarget(target: string | NLTarget): string {
  if (typeof target === "string") return target;
  return `ai:"${target.instruction}"`;
}

function describeCondition(
  condition: string | NLTarget | ((page: PageView) => boolean | Promise<boolean>),
): string {
  if (typeof condition === "string") return condition;
  if (typeof condition === "function") return "<predicate>";
  return `ai:"${condition.instruction}"`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.message;
  return String(err);
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? s;
}

/** Internal signal: a target resolved to >1 element and no nth was given. */
class MultiMatchSignal extends Error {
  constructor(
    readonly selector: string,
    readonly count: number,
  ) {
    super(`selector matched ${count} elements`);
    this.name = "MultiMatchSignal";
  }
}

/** Internal signal: goto landed on a >=400 page and throwOnHttpError is on. */
class HttpStatusSignal extends Error {
  constructor(readonly status: number) {
    super(`navigation returned HTTP ${status}`);
    this.name = "HttpStatusSignal";
  }
}

/** Fallback recognition of Playwright's strict-mode violation, if one slips through. */
function strictModeCount(cause: unknown): number | undefined {
  const msg = cause instanceof Error ? cause.message : String(cause ?? "");
  const m = /strict mode violation:.*?resolved to (\d+) element/is.exec(msg);
  return m ? Number(m[1]) : undefined;
}

function isPlainSelector(target: string): boolean {
  return !target.startsWith("ai:") && !target.startsWith("<");
}

/** Pull the real actionability reason out of Playwright's call log, if present. */
function actionabilityReason(cause: unknown): string {
  const msg = cause instanceof Error ? cause.message : String(cause ?? "");
  const lines = msg.split("\n").map((l) => l.trim());
  const hit = lines.find((l) =>
    /not (enabled|visible|stable|editable)|intercepts pointer events|outside of the viewport|not attached/i.test(l),
  );
  return (hit ?? lines[0] ?? msg).replace(/^-\s*/, "");
}

/**
 * Validate LLM-extracted data against the caller's schema. Best-effort: the
 * cached selector-map path yields strings, so a strict schema (e.g. z.number())
 * may not parse — we return the raw data rather than throwing away a good run,
 * but the failure is reported (not swallowed silently) via `onError`, which the
 * caller records in the trace so it's debuggable.
 */
function coerceSchema<T>(schema: Schema<T>, data: unknown, onError?: (e: unknown) => void): T {
  try {
    return schema.parse(data);
  } catch (e) {
    onError?.(e);
    return data as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

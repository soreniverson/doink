/**
 * computer-sdk — The Frozen API Surface (Phase 0)
 * ================================================
 *
 * This file is the contract. Everything downstream (resolver, tracer, backends,
 * adapters, the hosted layer) honors these types. Do not change this surface
 * without a version bump.
 *
 * The three rules this surface encodes:
 *   1. A plain string is always deterministic and always free.
 *   2. The LLM path is always visible in the source — it requires `ai(...)`.
 *   3. Every action is traced; failures are debuggable, not just "not found".
 */

// ---------------------------------------------------------------------------
// Natural-language targets — the ONLY way to invoke the LLM path.
// ---------------------------------------------------------------------------

/**
 * Branding symbols. `ai(...)` stamps these onto its return value so the client
 * can tell an NL target apart from a plain selector string at runtime. Using
 * `Symbol.for` keeps the brand stable across module realms / duplicate installs.
 */
export const NL_TARGET: unique symbol = Symbol.for("computer-sdk.NLTarget");
export const NL_EXTRACT: unique symbol = Symbol.for("computer-sdk.NLExtract");

/** A natural-language instruction to resolve an element via the LLM path. */
export interface NLTarget {
  readonly [NL_TARGET]: true;
  readonly instruction: string;
}

/** A natural-language instruction to extract structured data via the LLM path. */
export interface NLExtract<T> {
  readonly [NL_EXTRACT]: true;
  readonly instruction: string;
  readonly schema: Schema<T>;
}

/**
 * A minimal, zod-compatible schema. Any object exposing `parse(data): T`
 * satisfies this — a zod schema does, so `extract(ai({ schema: z.object(...) }))`
 * type-checks with no adapter. `jsonSchema` is an optional hint handed to the
 * model to shape its output; omit it and the resolver derives a best-effort one.
 */
export interface Schema<T> {
  parse(data: unknown): T;
  /** Optional JSON-Schema hint used to prompt the model. */
  readonly jsonSchema?: Record<string, unknown>;
}

/** A free, deterministic extraction target: field name -> CSS selector. */
export type SelectorMap = Record<string, string>;

/** What a target actually resolved to — surfaced on every ActionResult. */
export interface ResolvedTarget {
  /** The concrete selector that was used against the page. */
  selector: string;
  /** How the selector was obtained. */
  kind: "selector" | "llm-resolved" | "predicate";
  /** The original NL instruction, when the target came from `ai(...)`. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/** Where the browser actually runs. Swapping this never changes the API. */
export type BackendConfig = "local" | LocalBackendConfig | CDPBackendConfig;

export interface LocalBackendConfig {
  kind?: "local";
  /** Default true. Set false to watch a real Chromium window. */
  headless?: boolean;
  /** Extra args passed to chromium.launch(). */
  args?: string[];
  /** Slow every operation by N ms — handy when watching a headed run. */
  slowMo?: number;
}

export interface CDPBackendConfig {
  /** e.g. "wss://connect.browserbase.com?apiKey=..." (Browserless/Steel/Browserbase/self-hosted). */
  cdpUrl: string;
}

/** A custom resolver function — the escape hatch so no provider blocks you. */
export type LLMResolveFn = (input: LLMResolveInput) => Promise<LLMResolveOutput>;

export interface LLMConfig {
  /** Built-in providers, or your own function. */
  provider: "anthropic" | "openai" | LLMResolveFn;
  /** BYO key. Falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY when omitted. */
  apiKey?: string;
  /** Model id. Sensible provider default when omitted. */
  model?: string;
  /** Override the API base URL (proxies, gateways, compatible endpoints). */
  baseUrl?: string;
  /** Cap tokens per resolution call. */
  maxTokens?: number;
}

export interface TraceConfig {
  /** Default true. */
  enabled?: boolean;
  /** Where replays + screenshots land. Default "./.traces". */
  dir?: string;
  /** Default true. */
  screenshotOnFailure?: boolean;
  /** Default true. */
  captureDomOnFailure?: boolean;
}

export interface CacheConfig {
  /** Default true. */
  enabled?: boolean;
  /** Committed to the repo = free reruns for the whole team. Default "./.computer-cache.json". */
  path?: string;
}

export interface ComputerClientConfig {
  /** Default "local". */
  backend?: BackendConfig;
  /** OPTIONAL. Only needed if you ever use `ai(...)`. */
  llm?: LLMConfig;
  /** Debugging output. On by default. `false` disables. */
  trace?: TraceConfig | false;
  /** The money-saver. On by default. `false` disables. */
  cache?: CacheConfig | false;
  /** Global default timeout (ms) for actions/waits. Default 15000. */
  defaultTimeout?: number;
  /**
   * Throw a ComputerError when goto() lands on a >=400 page. Default true — an
   * agent that navigates onto a 404/500 wants to know NOW, not fail confusingly
   * three actions later. Set false to get the status on the result without a throw.
   */
  throwOnHttpError?: boolean;
}

// ---------------------------------------------------------------------------
// Per-primitive option bags
// ---------------------------------------------------------------------------

export interface GotoOptions {
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeout?: number;
  referer?: string;
  /** Override the client's default: throw a ComputerError on a >=400 landing. */
  throwOnHttpError?: boolean;
}

export interface ClickOptions {
  timeout?: number;
  force?: boolean;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  /** Index to use when the resolved target matches multiple elements. */
  nth?: number;
}

export interface TypeOptions {
  timeout?: number;
  /** Clear the field before typing. Default true. */
  clear?: boolean;
  /** Per-key delay in ms (simulate human typing). */
  delay?: number;
  /** Press Enter after typing. */
  pressEnter?: boolean;
  nth?: number;
}

export interface ReadOptions {
  /** Scope the read to a selector; omit for the whole page. */
  selector?: string;
  /** Return innerText (visible) vs textContent (raw). Default "innerText". */
  mode?: "innerText" | "textContent";
}

export interface ExtractOptions {
  timeout?: number;
}

export interface ObserveOptions {
  /** Cap the number of returned candidates. Default 50. */
  limit?: number;
  /** Include non-visible elements. Default false. */
  includeHidden?: boolean;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  /** Also write the PNG here (in addition to the trace dir). */
  path?: string;
  /** Screenshot a single element. */
  selector?: string;
  type?: "png" | "jpeg";
}

export interface DownloadOptions {
  timeout?: number;
  /** Save the downloaded file here (absolute or relative to cwd). */
  saveAs?: string;
  /** Directory for downloads when saveAs is omitted. Default "./.downloads". */
  dir?: string;
}

export interface WaitOptions {
  timeout?: number;
  /** Poll interval (ms) for predicate/NL conditions. Default 250. */
  pollInterval?: number;
  /** For selector conditions: what state to await. Default "visible". */
  state?: "attached" | "detached" | "visible" | "hidden";
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface NavigationResult {
  ok: true;
  url: string;
  status?: number;
  durationMs: number;
}

export interface ActionResult {
  ok: true;
  /** What selector actually got used (esp. after ai() resolution). */
  target: ResolvedTarget;
  durationMs: number;
  /** True only on a cache-miss LLM resolution. */
  resolvedByLLM: boolean;
  /** True if an ai() call was served from cache (free). */
  cached: boolean;
}

export interface DownloadResult extends ActionResult {
  /** Absolute path to the saved file. */
  path: string;
  /** The filename we saved it as. */
  filename: string;
  /** The filename the site suggested. */
  suggestedFilename: string;
  sizeBytes: number;
}

/** A candidate action/element surfaced by `observe`. */
export interface Observation {
  /** A concrete selector that resolves to this element. */
  selector: string;
  /** ARIA-ish role: "button" | "link" | "textbox" | "checkbox" | ... */
  role: string;
  tag: string;
  /** Visible text / value. */
  text?: string;
  /** Accessible name (aria-label, associated <label>, placeholder, ...). */
  name?: string;
  /** True when the element is visible in the layout. */
  visible: boolean;
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// PageView — the read-only handle passed to waitFor predicates
// ---------------------------------------------------------------------------

export interface PageView {
  url(): string;
  title(): Promise<string>;
  /** Visible text of the page (or a scoped selector). */
  text(selector?: string): Promise<string>;
  /** Number of elements matching a selector. */
  count(selector: string): Promise<number>;
  /** Does at least one element match + is it attached? */
  exists(selector: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Trace — the debugging surface, in memory and on disk
// ---------------------------------------------------------------------------

export interface TraceEntry {
  /** ISO timestamp. */
  ts: string;
  /** "goto" | "click" | "type" | "read" | "extract" | "observe" | "screenshot" | "download" | "waitFor". */
  action: string;
  /** What was asked for (selector or NL instruction). */
  target: string;
  ok: boolean;
  durationMs: number;
  resolvedByLLM?: boolean;
  cached?: boolean;
  /** The concrete selector used, once resolved. */
  resolvedSelector?: string;
  pageUrl?: string;
  pageTitle?: string;
  /** Present on failures. */
  error?: TraceError;
  /** Screenshot path (failures always; successes optionally). */
  screenshotPath?: string;
  /** Free-form details (typed text length, extracted keys, observe count, ...). */
  meta?: Record<string, unknown>;
}

export interface TraceError {
  /** The headline (first line) of the failure. */
  message: string;
  /** The full multi-line rendered error (page + hint + dom + replay). */
  rendered?: string;
  suggestion?: string;
  domExcerpt?: string;
}

export interface Trace {
  sessionId: string;
  /** Directory this session's artifacts were written to. */
  dir: string;
  startedAt: string;
  entries: TraceEntry[];
}

// ---------------------------------------------------------------------------
// LLM resolver I/O — the swappable seam (llm/types.ts implements clients)
// ---------------------------------------------------------------------------

/** Input handed to an LLM client to resolve an NL target into selector(s). */
export interface LLMResolveInput {
  kind: "locate" | "extract" | "observe";
  instruction: string;
  /** Normalized URL of the page. */
  url: string;
  /** A compact accessibility/DOM snapshot the model can reason over. */
  snapshot: string;
  /** PNG screenshot bytes, when available. */
  screenshot?: Buffer;
  /** For extract: the JSON-Schema shape the model should target. */
  jsonSchema?: Record<string, unknown>;
}

/**
 * What an LLM client returns. The unifying idea: the model always resolves to
 * SELECTORS, which are cached and replayed deterministically (free) on reruns.
 *  - "locate"  -> `selector`
 *  - "extract" -> `selectorMap` (field -> selector)
 *  - "observe" -> `selectors`
 */
export interface LLMResolveOutput {
  /** For "locate": a concrete CSS selector that resolves the target. */
  selector?: string;
  /** For "extract": a map of schema field -> CSS selector. */
  selectorMap?: Record<string, string>;
  /** For "observe": concrete selectors for the matching elements. */
  selectors?: string[];
  /** A model may return data directly (not cacheable as selectors). */
  data?: unknown;
  /** Optional model rationale, stored in the trace for debugging. */
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// The frozen client interface. Nine primitives + lifecycle.
// ---------------------------------------------------------------------------

export interface ComputerClient {
  /** Navigate. Deterministic only. */
  goto(url: string, opts?: GotoOptions): Promise<NavigationResult>;

  /** Click. Free with a selector; LLM with ai("description"). */
  click(target: string | NLTarget, opts?: ClickOptions): Promise<ActionResult>;

  /** Type into a field. Free with a selector; LLM with ai("the search box"). */
  type(target: string | NLTarget, text: string, opts?: TypeOptions): Promise<ActionResult>;

  /** Get page text. Deterministic. Optionally scoped to a selector. */
  read(opts?: ReadOptions): Promise<string>;

  /** Structured extraction. Selector map (free) or ai({ schema, instruction }) (LLM). */
  extract<T>(target: SelectorMap | NLExtract<T>, opts?: ExtractOptions): Promise<T>;

  /** "What can I do on this page?" Heuristic scan (free) or ai("...") (LLM). */
  observe(target?: string | NLTarget, opts?: ObserveOptions): Promise<Observation[]>;

  /** Screenshot. Deterministic. Returns a Buffer + writes to trace. */
  screenshot(opts?: ScreenshotOptions): Promise<Buffer>;

  /** Trigger + capture a download. Free with a selector; LLM with ai(...). */
  download(target: string | NLTarget, opts?: DownloadOptions): Promise<DownloadResult>;

  /** Wait for a condition. Selector, NL, or a predicate fn. */
  waitFor(
    condition: string | NLTarget | ((page: PageView) => boolean | Promise<boolean>),
    opts?: WaitOptions,
  ): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
  /** Access the in-memory trace of this session. */
  trace(): Trace;
}

/**
 * ResolutionCache — the money-saver (rule #3).
 *
 * Keyed by (page-signature, instruction-key). The first ai() call for a page
 * pays one LLM call and stores the resolved selector(s); repeat runs replay
 * them for free. Commit the JSON file and the whole team's reruns are free.
 *
 * The store is JSON on disk, loaded lazily and written after each mutation.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** The resolved payload we cache. Mirrors LLMResolveOutput's selector forms. */
export interface CacheValue {
  selector?: string;
  selectorMap?: Record<string, string>;
  selectors?: string[];
  /**
   * Accessible-name/text fingerprint of the located element, used to re-validate
   * a fragile positional selector on a cache hit (does it still point at the
   * same thing?) without spending an LLM call.
   */
  fingerprint?: string;
}

/** The stable-attribute subset of an element used to build the page signature. */
export interface SkeletonElement {
  tag: string;
  role: string;
  text?: string;
  name?: string;
  attributes?: Record<string, string>;
}

/**
 * The id/content-STABLE structural skeleton a page signature is hashed from.
 *
 * The old signature hashed each element's CONCRETE selector — which contains the
 * very dynamic ids that churn (uitp.dynamicid's uuid, Hacker News' `#up_<id>`),
 * so every load produced a new signature and the cache never hit. This instead
 * describes each interactive element by its tag + role + STABLE attributes only,
 * and collapses repeated siblings (a unique set), so the same page yields the
 * same signature across loads even as ids churn and content changes.
 *
 * Included: tag, role, type, stable id, data-testid, aria-label/placeholder, and
 * short stable text/accessible-name (digits normalized). Excluded: dynamic ids
 * (uuid/hex/long-digit/hydration), hashed classes, href, and nth positional paths.
 */
export function stableSkeleton(elements: SkeletonElement[]): string {
  const unique = new Set<string>();
  for (const el of elements) {
    const parts = describeStable(el);
    // Skip no-signal elements (only role+tag, nothing discriminating): an
    // anonymous icon/link that flickers in and out with render timing must not
    // flip the signature. Real, identifiable controls always carry a
    // type/id/testid/label/name.
    if (parts.length > 2) unique.add(parts.join("|"));
  }
  return [...unique].sort().join("\n");
}

function describeStable(el: SkeletonElement): string[] {
  const parts = [`r:${el.role}`, `t:${el.tag}`];
  const a = el.attributes ?? {};
  if (a.type) parts.push(`ty:${a.type}`);
  const testid = a["data-testid"] ?? a["data-test"];
  if (testid && isStableToken(testid)) parts.push(`tid:${testid}`);
  if (a.id && isStableToken(a.id)) parts.push(`id:${a.id}`);
  const label = a["aria-label"] ?? a.placeholder;
  if (label && isStableText(label)) parts.push(`l:${normalizeText(label)}`);
  const name = el.name ?? el.text;
  if (name && isStableText(name)) parts.push(`n:${normalizeText(name)}`);
  return parts;
}

/** Lowercase, collapse whitespace, and blank out digit runs (so "Item 5" ≡ "Item 12"). */
export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#");
}

function isStableText(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 30 && !/[0-9a-f]{8,}/i.test(t);
}

/** A token (id/testid) is stable if it has no dynamic-looking runs. */
export function isStableToken(v: string): boolean {
  return !!v && v.length <= 40 && !looksDynamic(v);
}

function looksDynamic(v: string): boolean {
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(v)) return true; // uuid
  if (/[0-9a-f]{7,}/i.test(v) && /\d/.test(v)) return true; // long hex + a digit
  if (/\d{3,}/.test(v)) return true; // a run of 3+ digits
  if (/[:]/.test(v)) return true; // framework hydration ids (React useId ":r0:")
  return false;
}

interface CacheEntry {
  value: CacheValue;
  resolvedAt: string;
}

type CacheDoc = {
  version: 1;
  entries: Record<string, Record<string, CacheEntry>>;
};

export interface ResolutionCacheConfig {
  enabled: boolean;
  path: string;
}

/**
 * A page signature: normalized URL + a short hash of the DOM structure.
 * Content (text) changes must NOT change it; structure changes must.
 */
export function pageSignature(url: string, structuralKey: string): string {
  const normalized = normalizeUrl(url);
  const hash = createHash("sha256").update(structuralKey).digest("hex").slice(0, 16);
  return `${normalized}#${hash}`;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.origin + url.pathname;
  } catch {
    return u;
  }
}

export class ResolutionCache {
  private readonly enabled: boolean;
  private readonly filePath: string;
  private doc: CacheDoc | null = null;
  private loading: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: ResolutionCacheConfig) {
    this.enabled = config.enabled;
    this.filePath = path.resolve(config.path);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.doc) return;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await fs.readFile(this.filePath, "utf8");
          const parsed = JSON.parse(raw) as CacheDoc;
          this.doc = parsed?.entries ? parsed : { version: 1, entries: {} };
        } catch {
          this.doc = { version: 1, entries: {} };
        }
      })();
    }
    await this.loading;
  }

  async get(signature: string, key: string): Promise<CacheValue | undefined> {
    if (!this.enabled) return undefined;
    await this.ensureLoaded();
    return this.doc?.entries[signature]?.[key]?.value;
  }

  async set(signature: string, key: string, value: CacheValue): Promise<void> {
    if (!this.enabled) return;
    await this.ensureLoaded();
    const doc = this.doc!;
    (doc.entries[signature] ??= {})[key] = { value, resolvedAt: new Date().toISOString() };
    await this.flush();
  }

  async delete(signature: string, key: string): Promise<void> {
    if (!this.enabled) return;
    await this.ensureLoaded();
    const bucket = this.doc?.entries[signature];
    if (bucket && key in bucket) {
      delete bucket[key];
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.enabled || !this.doc) return;
    const snapshot = JSON.stringify(this.doc, null, 2);
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, snapshot, "utf8");
      })
      .catch(() => {});
    await this.writeChain;
  }
}

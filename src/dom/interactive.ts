/**
 * Shared in-page scanner for interactive elements.
 *
 * One careful implementation of "what can you do on this page, and what's a
 * stable selector for it" — reused by the failure hint logic (Phase 2) and by
 * observe() (Phase 3). It runs entirely inside the browser via page.evaluate.
 */
import type { Page } from "playwright";
import type { Observation } from "../types.js";

export interface RawElement {
  tag: string;
  role: string;
  id: string | null;
  name: string | null;
  type: string | null;
  testid: string | null;
  classes: string[];
  /** Visible text or value/placeholder, trimmed + truncated. */
  text: string;
  ariaLabel: string | null;
  placeholder: string | null;
  href: string | null;
  visible: boolean;
  /** A stable, unique-where-possible selector for this element. */
  selector: string;
  /** How many elements `selector` matches (1 = unique). */
  matchCount: number;
  /** Truncated outerHTML, for DOM excerpts. */
  html: string;
}

export interface CollectOptions {
  limit: number;
  includeHidden: boolean;
  /** Restrict the scan to descendants of this selector. */
  scopeSelector?: string;
}

export async function collectInteractive(
  page: Page,
  opts: CollectOptions,
): Promise<RawElement[]> {
  const args = {
    limit: opts.limit,
    includeHidden: opts.includeHidden,
    scopeSelector: opts.scopeSelector ?? null,
  };
  // Robustness note: some bundlers/runners (esbuild with keepNames — tsx, and
  // by default tsup) wrap functions with a `__name(...)` helper. When Playwright
  // serializes a function to run it in the page, that helper is undefined in the
  // browser and the evaluate throws `__name is not defined`. We sidestep it by
  // shimming __name to identity in scope and passing the whole thing as a string,
  // so page.evaluate needs no helpers from our module — works under tsx, vitest,
  // the built dist, and any downstream bundler alike.
  const src =
    `(() => { const __name = (f) => f;` +
    ` return (${collectInPage.toString()})(${JSON.stringify(args)}); })()`;
  return (await page.evaluate(src)) as RawElement[];
}

/**
 * Describe a specific list of selectors (used by observe's ai(...) path).
 * String-based evaluate for the same bundler-safety reasons as above.
 */
export async function describeSelectors(
  page: Page,
  selectors: string[],
): Promise<Observation[]> {
  const src =
    `(() => { const __name = (f) => f; const sels = ${JSON.stringify(selectors)};` +
    ` const roleOf = (el) => { const r = el.getAttribute('role'); if (r) return r;` +
    ` const tag = el.tagName.toLowerCase();` +
    ` if (tag==='a'&&el.hasAttribute('href')) return 'link';` +
    ` if (tag==='button') return 'button';` +
    ` if (tag==='select') return 'combobox';` +
    ` if (tag==='textarea') return 'textbox';` +
    ` if (tag==='input'){ const t=(el.getAttribute('type')||'text').toLowerCase();` +
    ` if(['button','submit','reset','image'].includes(t)) return 'button';` +
    ` if(t==='checkbox') return 'checkbox'; if(t==='radio') return 'radio'; return 'textbox'; }` +
    ` return tag; };` +
    ` return sels.map((sel) => { try { const el = document.querySelector(sel); if (!el) return null;` +
    ` const rect = el.getBoundingClientRect(); const st = getComputedStyle(el);` +
    ` const visible = rect.width>0 && rect.height>0 && st.display!=='none' && st.visibility!=='hidden';` +
    ` const text = (el.textContent||'').trim().slice(0,120);` +
    ` const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') || text || '';` +
    ` const obs = { selector: sel, role: roleOf(el), tag: el.tagName.toLowerCase(), visible };` +
    ` if (text) obs.text = text; if (name) obs.name = name; return obs;` +
    ` } catch { return null; } }).filter(Boolean);` +
    ` })()`;
  return (await page.evaluate(src)) as Observation[];
}

/**
 * Return the outerHTML of up to `limit` elements matching a selector, plus the
 * total count. Used to render the ambiguous multi-match error truthfully.
 * String-based evaluate for the same bundler-safety reasons as above.
 */
export async function matchedElementsHtml(
  page: Page,
  selector: string,
  limit = 3,
): Promise<{ count: number; html: string[] }> {
  const src =
    `(() => { const __name = (f) => f;` +
    ` let els = []; try { els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); } catch { return { count: 0, html: [] }; }` +
    ` return { count: els.length, html: els.slice(0, ${limit}).map((e) => (e.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 200)) }; })()`;
  try {
    return (await page.evaluate(src)) as { count: number; html: string[] };
  } catch {
    return { count: 0, html: [] };
  }
}

/**
 * Serialized into the page. Must be self-contained (no outer references).
 */
function collectInPage(opts: {
  limit: number;
  includeHidden: boolean;
  scopeSelector: string | null;
}): RawElement[] {
  const INTERACTIVE =
    "a[href], button, input, select, textarea, [role], [onclick], [tabindex], [contenteditable=''], [contenteditable='true']";

  const root: ParentNode = opts.scopeSelector
    ? document.querySelector(opts.scopeSelector) ?? document
    : document;

  const escAttr = (v: string) => v.replace(/["\\]/g, "\\$&");
  const uniq = (sel: string): number => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return 0;
    }
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") ?? "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "textbox";
    }
    return tag;
  };

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    return true;
  };

  const nthPath = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      let seg = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      if (parent && parent.tagName.toLowerCase() === "body") {
        parts.unshift("body");
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
  };

    // A value looks dynamic (and so must not be baked into a cached selector) if
    // it has uuid/long-hex/3+-digit runs or a framework hydration marker.
    const looksDynamic = (v: string): boolean =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(v) ||
      (/[0-9a-f]{7,}/i.test(v) && /\d/.test(v)) ||
      /\d{3,}/.test(v) ||
      /[:]/.test(v);

  const selectorFor = (el: Element): { selector: string; matchCount: number } => {
    const tag = el.tagName.toLowerCase();
    const candidates: string[] = [];
    // Prefer a STABLE id; a dynamic id (uuid/hash) would rot every load and make
    // a cached selector stale — fall through to a positional path instead.
    if (el.id && !looksDynamic(el.id)) candidates.push(`#${CSS.escape(el.id)}`);
    const testid = el.getAttribute("data-testid");
    if (testid) candidates.push(`[data-testid="${escAttr(testid)}"]`);
    const name = el.getAttribute("name");
    if (name) candidates.push(`${tag}[name="${escAttr(name)}"]`);
    const type = el.getAttribute("type");
    if (type && (tag === "input" || tag === "button")) {
      candidates.push(`${tag}[type="${escAttr(type)}"]`);
    }
    const aria = el.getAttribute("aria-label");
    if (aria) candidates.push(`${tag}[aria-label="${escAttr(aria)}"]`);
    for (const c of candidates) {
      if (uniq(c) === 1) return { selector: c, matchCount: 1 };
    }
    const path = nthPath(el);
    return { selector: path, matchCount: uniq(path) };
  };

  const accessibleName = (el: Element): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.textContent) return wrapping.textContent.trim();
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    const text = (el.textContent ?? "").trim();
    if (text) return text;
    const value = (el as HTMLInputElement).value;
    return value ? value.trim() : "";
  };

  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

  const seen = new Set<Element>();
  const out: RawElement[] = [];
  const nodes = Array.from(root.querySelectorAll(INTERACTIVE));

  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    const visible = isVisible(el);
    if (!visible && !opts.includeHidden) continue;

    const tag = el.tagName.toLowerCase();
    const { selector, matchCount } = selectorFor(el);
    const accName = accessibleName(el);
    const rawText = (el.textContent ?? "").trim();
    const value = (el as HTMLInputElement).value ?? "";

    out.push({
      tag,
      role: roleOf(el),
      id: el.id || null,
      // `name` is the accessible/display name (what a human sees), not the raw
      // name attribute — that lives inside selectorFor.
      name: accName || null,
      type: el.getAttribute("type"),
      testid: el.getAttribute("data-testid"),
      classes: Array.from(el.classList),
      text: trunc(rawText || value, 120),
      ariaLabel: el.getAttribute("aria-label"),
      placeholder: el.getAttribute("placeholder"),
      href: el.getAttribute("href"),
      visible,
      selector,
      matchCount,
      html: trunc(el.outerHTML.replace(/\s+/g, " ").trim(), 200),
    });
    if (out.length >= opts.limit) break;
  }

  return out;
}

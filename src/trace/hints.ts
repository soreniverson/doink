/**
 * hints.ts — "did you mean 'button[type=\"submit\"]'? (1 match)".
 *
 * This is the product. On a failed selector we scan the page's interactive
 * elements, score each against what you asked for, and suggest the one you most
 * likely meant — plus a "found: N buttons, 0 matched" summary and a DOM excerpt.
 */
import type { Page } from "playwright";
import { collectInteractive, type RawElement } from "../dom/interactive.js";

export interface Hint {
  /** e.g. `did you mean 'button[type="submit"]'? (1 match)` */
  suggestion?: string;
  /** e.g. `8 buttons, 0 matched '#submit'` — the count is the TRUE match count. */
  found?: string;
  /** A relevant slice of the DOM at failure time. */
  domExcerpt?: string;
  /** How many elements the target selector actually matched (0, 1, or N). */
  matchCount?: number;
}

export interface HintOptions {
  captureDom: boolean;
}

const NON_SELECTOR = new Set(["<predicate>", "<page>", "<all>"]);

export async function buildHint(
  page: Page,
  _action: string,
  target: string,
  opts: HintOptions,
): Promise<Hint> {
  const isSelector =
    !target.startsWith("ai:") && !target.startsWith("<") && !NON_SELECTOR.has(target);

  const elements = await collectInteractive(page, { limit: 250, includeHidden: true });
  const visible = elements.filter((e) => e.visible);

  const hint: Hint = {};

  // The TRUE number of elements the target selector matches — never hardcode 0.
  const trueMatch = isSelector ? await countMatches(page, target) : undefined;
  hint.matchCount = trueMatch;
  const matchedWord = trueMatch === undefined ? "matched" : `${trueMatch} matched`;

  if (isSelector && elements.length > 0) {
    const targetTokens = tokenize(target);
    let best: { el: RawElement; score: number } | null = null;
    for (const el of elements) {
      const score = scoreElement(target, targetTokens, el);
      if (!best || score > best.score) best = { el, score };
    }

    if (best && best.score >= 0.25) {
      const el = best.el;
      const noun = friendlyNoun(el.role);
      const count = visible.filter((e) => e.role === el.role).length;
      hint.found = `${count} ${noun}, ${matchedWord} '${target}'`;
      // Only offer a "did you mean" when the target itself matched nothing.
      if (trueMatch === 0) {
        const matches = el.matchCount === 1 ? "1 match" : `${el.matchCount} matches`;
        hint.suggestion = `did you mean '${el.selector}'? (${matches})`;
      }
    } else {
      hint.found = `${visible.length} interactive elements, ${matchedWord} '${target}'`;
    }
  } else if (elements.length > 0) {
    hint.found = `${visible.length} interactive elements on the page`;
  }

  if (opts.captureDom) {
    hint.domExcerpt = buildDomExcerpt(elements, target);
  }

  return hint;
}

/** How many elements the selector matches right now (0 on an invalid selector). */
async function countMatches(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

/** Rank a few most-relevant elements and dump their outer HTML. */
function buildDomExcerpt(elements: RawElement[], target: string): string {
  const targetTokens = tokenize(target);
  const ranked = [...elements]
    .map((el) => ({ el, score: scoreElement(target, targetTokens, el) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return ranked
    .map(({ el }) => `${el.role.padEnd(8)} ${el.selector}\n  ${el.html}`)
    .join("\n");
}

// ---- scoring --------------------------------------------------------------

function scoreElement(target: string, targetTokens: string[], el: RawElement): number {
  const elTokens = elementTokens(el);
  const elSet = new Set(elTokens);

  let overlap = 0;
  for (const t of targetTokens) if (elSet.has(t)) overlap++;
  const tokenRecall = targetTokens.length > 0 ? overlap / targetTokens.length : 0;

  const selectorSim = levenshteinRatio(target.toLowerCase(), el.selector.toLowerCase());

  // Token overlap catches "#submit" -> button[type=submit]; selector similarity
  // catches pure typos like "#emial" -> "#email" that share no tokens.
  let score = 0.6 * tokenRecall + 0.4 * selectorSim;

  // Strong signal: the target names this element's id / type directly.
  if (el.id && targetTokens.includes(el.id.toLowerCase())) score += 0.3;
  if (el.type && targetTokens.includes(el.type.toLowerCase())) score += 0.1;

  return Math.min(score, 1);
}

function elementTokens(el: RawElement): string[] {
  const parts = [
    el.tag,
    el.role,
    el.id ?? "",
    el.name ?? "",
    el.type ?? "",
    el.testid ?? "",
    el.ariaLabel ?? "",
    el.placeholder ?? "",
    el.text,
    ...el.classes,
  ];
  return parts.flatMap(splitWords);
}

function tokenize(selector: string): string[] {
  // Strip CSS punctuation and split into meaningful words.
  return splitWords(selector.replace(/[#.\[\]="'>~+*:()]/g, " "));
}

function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
}

function friendlyNoun(role: string): string {
  switch (role) {
    case "button":
      return "buttons";
    case "link":
      return "links";
    case "textbox":
      return "inputs";
    case "checkbox":
      return "checkboxes";
    case "radio":
      return "radios";
    case "combobox":
      return "dropdowns";
    default:
      return `${role} elements`;
  }
}

// ---- string distance ------------------------------------------------------

function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

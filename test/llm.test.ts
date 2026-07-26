/**
 * Phase 4 — the LLM layer: ai(), resolver, cache, self-heal.
 *
 * The LLM is MOCKED (a call-counting custom provider function) so these tests
 * are deterministic and free. They protect the money story: pay once, then free.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient, ai } from "../src/index.js";
import type { LLMResolveInput, LLMResolveOutput } from "../src/types.js";
import { useFixture } from "./helpers.js";

const fx = useFixture();
const CACHE_DIR = path.resolve("./.cache-test");

/** A mock provider that counts calls and resolves instructions to fixture selectors. */
function mockLLM() {
  const inputs: LLMResolveInput[] = [];
  const provider = async (input: LLMResolveInput): Promise<LLMResolveOutput> => {
    inputs.push(input);
    if (input.kind === "locate") {
      if (/toast|saved/i.test(input.instruction)) return { selector: "#late-toast" };
      if (/login/i.test(input.instruction)) return { selector: "#login" };
      if (/reveal|secret/i.test(input.instruction)) return { selector: "#reveal" };
      if (/email/i.test(input.instruction)) return { selector: "#email" };
      return { selector: "#login" };
    }
    if (input.kind === "extract") {
      return { selectorMap: { title: ".product-title", price: ".price" } };
    }
    if (input.kind === "observe") {
      // A legitimately-empty result for anything about "admin".
      if (/admin|nonexistent/i.test(input.instruction)) return { selectors: [] };
      return { selectors: ["#login", "#reveal"] };
    }
    return {};
  };
  return { provider, calls: () => inputs.length, inputs };
}

let cacheSeq = 0;
function cachePath(): string {
  cacheSeq += 1;
  return path.join(CACHE_DIR, `cache-${cacheSeq}.json`);
}

function client(provider: (i: LLMResolveInput) => Promise<LLMResolveOutput>, cache: string) {
  return new ComputerClient({
    backend: "local",
    trace: false,
    llm: { provider },
    cache: { path: cache },
  });
}

describe("LLM layer (mocked): cache + self-heal", () => {
  afterEach(async () => {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
  });

  it("first ai() locate resolves + caches; second is served from cache with zero LLM calls", async () => {
    const llm = mockLLM();
    const cache = cachePath();
    const c = client(llm.provider, cache);
    try {
      await c.goto(fx.url("/index.html"));

      const r1 = await c.click(ai("the login button"));
      expect(r1.resolvedByLLM).toBe(true);
      expect(r1.cached).toBe(false);
      expect(r1.target.selector).toBe("#login");
      expect(llm.calls()).toBe(1);

      // Navigate back to the same page (fresh DOM, same signature).
      await c.goto(fx.url("/index.html"));
      const r2 = await c.click(ai("the login button"));
      expect(r2.resolvedByLLM).toBe(false);
      expect(r2.cached).toBe(true);
      expect(r2.target.selector).toBe("#login");
      // The whole point: NO new LLM call.
      expect(llm.calls()).toBe(1);
    } finally {
      await c.close();
    }
  });

  it("a committed cache means free reruns in a fresh process (new client, zero calls)", async () => {
    const llm = mockLLM();
    const cache = cachePath();

    const a = client(llm.provider, cache);
    try {
      await a.goto(fx.url("/index.html"));
      await a.click(ai("the login button"));
      expect(llm.calls()).toBe(1);
    } finally {
      await a.close();
    }

    // Fresh client reading the same committed cache file.
    const b = client(llm.provider, cache);
    try {
      await b.goto(fx.url("/index.html"));
      const r = await b.click(ai("the login button"));
      expect(r.cached).toBe(true);
      expect(r.resolvedByLLM).toBe(false);
      expect(llm.calls()).toBe(1); // still 1 — the rerun was free
    } finally {
      await b.close();
    }
  });

  it("a broken cached selector self-heals with exactly one re-resolution", async () => {
    const llm = mockLLM();
    const cache = cachePath();

    const a = client(llm.provider, cache);
    try {
      await a.goto(fx.url("/index.html"));
      await a.click(ai("the login button"));
      expect(llm.calls()).toBe(1);
    } finally {
      await a.close();
    }

    // Corrupt the cached selector on disk to simulate a page that drifted.
    const doc = JSON.parse(await fs.readFile(cache, "utf8")) as {
      entries: Record<string, Record<string, { value: { selector?: string } }>>;
    };
    for (const sig of Object.keys(doc.entries)) {
      for (const key of Object.keys(doc.entries[sig]!)) {
        doc.entries[sig]![key]!.value.selector = "#gone-nonexistent";
      }
    }
    await fs.writeFile(cache, JSON.stringify(doc));

    // Fresh client loads the corrupted cache -> stale -> heal (exactly one call).
    const b = client(llm.provider, cache);
    try {
      await b.goto(fx.url("/index.html"));
      const r = await b.click(ai("the login button"));
      expect(r.resolvedByLLM).toBe(true); // healed via a fresh resolution
      expect(r.cached).toBe(false);
      expect(r.target.selector).toBe("#login");
      expect(llm.calls()).toBe(2); // exactly one extra call
    } finally {
      await b.close();
    }
  });

  it("extract via ai() caches a selector map; second run is free", async () => {
    const llm = mockLLM();
    const cache = cachePath();
    const c = client(llm.provider, cache);
    try {
      await c.goto(fx.url("/index.html"));
      const d1 = await c.extract(
        ai({ schema: { parse: (x) => x as { title: string; price: string } }, instruction: "title and price" }),
      );
      expect(d1.title).toBe("Monument Grotesk License");
      expect(d1.price).toBe("$49.00");
      expect(llm.calls()).toBe(1);

      await c.goto(fx.url("/index.html"));
      const d2 = await c.extract(
        ai({ schema: { parse: (x) => x as { title: string; price: string } }, instruction: "title and price" }),
      );
      expect(d2.price).toBe("$49.00");
      expect(llm.calls()).toBe(1); // cached selector map, no LLM call
    } finally {
      await c.close();
    }
  });

  it("observe via ai() caches selectors; second run is free", async () => {
    const llm = mockLLM();
    const cache = cachePath();
    const c = client(llm.provider, cache);
    try {
      await c.goto(fx.url("/index.html"));
      const o1 = await c.observe(ai("the primary buttons"));
      expect(o1.map((o) => o.selector).sort()).toEqual(["#login", "#reveal"]);
      expect(llm.calls()).toBe(1);

      await c.goto(fx.url("/index.html"));
      const o2 = await c.observe(ai("the primary buttons"));
      expect(o2.length).toBe(2);
      expect(llm.calls()).toBe(1);
    } finally {
      await c.close();
    }
  });

  it("waitFor(ai(...)) polls for an element that mounts later (not present at call time)", async () => {
    const llm = mockLLM();
    const cache = cachePath();
    const c = client(llm.provider, cache);
    try {
      await c.goto(fx.url("/index.html"));
      // #late-toast does not exist yet; it is appended ~350ms after this click.
      await c.click("#make-toast");
      // Must WAIT for it to appear, not throw immediately.
      await c.waitFor(ai("the saved toast"), { timeout: 5000, pollInterval: 100 });
      const text = await c.read({ selector: "#late-toast" });
      expect(text).toBe("Saved!");
    } finally {
      await c.close();
    }
  });

  it("observe(ai(...)) that legitimately matches nothing caches the empty result (no re-resolve)", async () => {
    const llm = mockLLM();
    const cache = cachePath();
    const c = client(llm.provider, cache);
    try {
      await c.goto(fx.url("/index.html"));
      const o1 = await c.observe(ai("any admin-only buttons"));
      expect(o1).toEqual([]);
      expect(llm.calls()).toBe(1);

      await c.goto(fx.url("/index.html"));
      const o2 = await c.observe(ai("any admin-only buttons"));
      expect(o2).toEqual([]);
      // The empty result was cached — no new LLM call.
      expect(llm.calls()).toBe(1);
    } finally {
      await c.close();
    }
  });

  it("with cache disabled, every ai() call hits the LLM", async () => {
    const llm = mockLLM();
    const c = new ComputerClient({ trace: false, cache: false, llm: { provider: llm.provider } });
    try {
      await c.goto(fx.url("/index.html"));
      await c.click(ai("the login button"));
      await c.goto(fx.url("/index.html"));
      const r = await c.click(ai("the login button"));
      expect(r.cached).toBe(false);
      expect(llm.calls()).toBe(2);
    } finally {
      await c.close();
    }
  });
});

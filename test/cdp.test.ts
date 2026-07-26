/**
 * Phase 5 — the backend seam. The SAME code that runs on local Playwright runs
 * against a remote CDP endpoint with only the `backend` config line changed.
 *
 * We can't hit a paid remote in CI, so we stand up a local CDP endpoint (a
 * Chromium launched with --remote-debugging-port) and connect over CDP to it —
 * exactly what Browserless/Steel/Browserbase expose.
 */
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { ComputerClient } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/server.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (addr && typeof addr === "object") s.close(() => resolve(addr.port));
      else reject(new Error("could not find a free port"));
    });
  });
}

async function waitForCdp(port: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("CDP endpoint never came up");
}

describe("CDP backend (local endpoint stands in for a remote one)", () => {
  let endpoint: Browser;
  let cdpUrl: string;
  let site: FixtureServer;

  beforeAll(async () => {
    const port = await freePort();
    endpoint = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
    await waitForCdp(port);
    cdpUrl = `http://127.0.0.1:${port}`;
    site = await startFixtureServer();
  });

  afterAll(async () => {
    await site.close();
    await endpoint.close();
  });

  it("runs the fixture flow unchanged over CDP", async () => {
    // The only difference from a local run: this one config line.
    const computer = new ComputerClient({ backend: { cdpUrl }, trace: false, cache: false });
    try {
      const nav = await computer.goto(`${site.url}/index.html`);
      expect(nav.status).toBe(200);

      await computer.type("#email", "cdp@example.com");
      await computer.click("#reveal");
      await computer.waitFor("#secret");
      const secret = await computer.read({ selector: "#secret" });
      expect(secret).toBe("The secret is 42.");

      const data = await computer.extract<{ price: string }>({ price: ".price" });
      expect(data.price).toBe("$49.00");

      const obs = await computer.observe();
      expect(obs.some((o) => o.selector === "#login")).toBe(true);
    } finally {
      await computer.close();
    }
  });

  it("surfaces the same structured error over CDP", async () => {
    const computer = new ComputerClient({ backend: { cdpUrl }, trace: false, cache: false });
    try {
      await computer.goto(`${site.url}/index.html`);
      const err = await computer
        .click("#submit", { timeout: 800 })
        .then(() => null)
        .catch((e) => e as Error & { suggestion?: string });
      expect(err).toBeTruthy();
      expect(err?.suggestion).toMatch(/#login/);
    } finally {
      await computer.close();
    }
  });
});

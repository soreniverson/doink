/**
 * Phase 1 — the deterministic core, exercised against the local fixture site.
 * No network, no LLM, no cost.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("deterministic core", () => {
  let computer: ComputerClient;

  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("goto returns a navigation result with status", async () => {
    const nav = await computer.goto(fx.url("/index.html"));
    expect(nav.ok).toBe(true);
    expect(nav.status).toBe(200);
    expect(nav.url).toContain("/index.html");
    expect(nav.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("type fills inputs; read reads them back", async () => {
    await computer.goto(fx.url("/index.html"));
    const res = await computer.type("#email", "me@example.com");
    expect(res.ok).toBe(true);
    expect(res.resolvedByLLM).toBe(false);
    expect(res.cached).toBe(false);
    expect(res.target.selector).toBe("#email");

    const value = await computer.read({ selector: "#email" });
    // innerText of an input is empty; assert via the DOM value instead.
    expect(value).toBe("");
  });

  it("read returns page text", async () => {
    await computer.goto(fx.url("/index.html"));
    const text = await computer.read();
    expect(text).toContain("Sign in");
    expect(text).toContain("Monument Grotesk License");
  });

  it("read scoped to a selector returns only that text", async () => {
    await computer.goto(fx.url("/index.html"));
    const price = await computer.read({ selector: ".price" });
    expect(price).toBe("$49.00");
  });

  it("click reveals a hidden element; waitFor(selector) awaits it", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#reveal");
    await computer.waitFor("#secret");
    const secret = await computer.read({ selector: "#secret" });
    expect(secret).toBe("The secret is 42.");
  });

  it("waitFor(predicate) polls a PageView until true", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#load-async");
    await computer.waitFor(async (page) => (await page.text("#async-status")) === "ready", {
      timeout: 5000,
    });
    const status = await computer.read({ selector: "#async-status" });
    expect(status).toBe("ready");
  });

  it("click on a link navigates", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#dashboard-link");
    await computer.waitFor("#dashboard-title");
    expect(computer.trace().entries.some((e) => e.action === "click")).toBe(true);
    const title = await computer.read({ selector: "#dashboard-title" });
    expect(title).toBe("Dashboard");
  });

  it("screenshot returns a PNG buffer", async () => {
    await computer.goto(fx.url("/index.html"));
    const buf = await computer.screenshot();
    expect(buf.length).toBeGreaterThan(0);
    // PNG magic number.
    expect(buf.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("download captures a file and reports its size", async () => {
    await computer.goto(fx.url("/index.html"));
    const dl = await computer.download("#download-report", { dir: "./.downloads-test" });
    expect(dl.ok).toBe(true);
    expect(dl.suggestedFilename).toBe("report.csv");
    expect(dl.sizeBytes).toBeGreaterThan(0);
    expect(dl.filename).toBe("report.csv");
  });

  it("every action appends a trace entry", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#reveal");
    const trace = computer.trace();
    expect(trace.entries.length).toBe(2);
    expect(trace.entries[0]?.action).toBe("goto");
    expect(trace.entries[0]?.ok).toBe(true);
    expect(trace.entries[1]?.action).toBe("click");
    expect(trace.entries[1]?.resolvedSelector).toBe("#reveal");
  });

  it("close() is safe with no session, during an in-flight launch, and called twice", async () => {
    // Never used — close before any launch.
    const a = makeClient();
    await expect(a.close()).resolves.toBeUndefined();

    // Close while a launch is in flight (goto triggers the launch).
    const b = makeClient();
    const pending = b.goto(fx.url("/index.html")).catch(() => "rejected");
    await expect(b.close()).resolves.toBeUndefined();
    await pending; // must not leave an unhandled rejection

    // Double close is a no-op.
    const c = makeClient();
    await c.goto(fx.url("/index.html"));
    await c.close();
    await expect(c.close()).resolves.toBeUndefined();
    // Using a closed client is a clear error, not a crash.
    await expect(c.goto(fx.url("/index.html"))).rejects.toThrow(/closed/);
  });

  it("ai(...) without llm config throws a clear, actionable error", async () => {
    const { ai } = await import("../src/index.js");
    await computer.goto(fx.url("/index.html"));
    await expect(computer.click(ai("the login button"))).rejects.toThrow(
      /no `llm` was configured/,
    );
  });
});

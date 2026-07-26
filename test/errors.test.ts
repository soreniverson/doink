/**
 * Phase 2 — structured errors + the "did you mean" hint.
 * This is the differentiation: a wrong selector produces a beautiful,
 * actionable failure, not a raw Playwright stack.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient, ComputerError } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("structured errors + hints", () => {
  let computer: ComputerClient;

  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("a failed click yields a ComputerError with screenshot, DOM excerpt, and a correct suggestion", async () => {
    await computer.goto(fx.url("/index.html"));

    let err: unknown;
    try {
      // No #submit exists, but #login is a type=submit button — the near match.
      await computer.click("#submit", { timeout: 1000 });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ComputerError);
    const ce = err as ComputerError;
    expect(ce.action).toBe("click");
    expect(ce.target).toBe("#submit");
    expect(ce.pageUrl).toContain("/index.html");
    expect(ce.pageTitle).toBe("Sign in");

    // The obsessive touches:
    expect(ce.screenshotPath).toBeTruthy();
    expect(ce.domExcerpt).toBeTruthy();
    expect(ce.found).toMatch(/buttons/);
    expect(ce.suggestion).toMatch(/#login/);
    expect(ce.tracePath).toContain("trace.json");

    // The rendered message is the aligned multi-line report.
    expect(ce.message).toContain("ClickError");
    expect(ce.message).toContain("did you mean");
    expect(ce.message).toContain("replay:");
  });

  it("the failure screenshot actually exists on disk", async () => {
    await computer.goto(fx.url("/index.html"));
    const ce = await computer
      .click("#nope-nothing", { timeout: 800 })
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(ce).toBeInstanceOf(ComputerError);
    const shot = (ce as ComputerError).screenshotPath;
    expect(shot).toBeTruthy();
    const stat = await fs.stat(shot!);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("records the failed action in the trace with the suggestion", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#submit", { timeout: 800 }).catch(() => {});

    const trace = computer.trace();
    const failed = trace.entries.find((e) => !e.ok);
    expect(failed).toBeTruthy();
    expect(failed?.action).toBe("click");
    expect(failed?.error?.suggestion).toMatch(/#login/);
    expect(failed?.screenshotPath).toBeTruthy();
  });

  it("writes a replayable trace.json to disk", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#reveal");

    const trace = computer.trace();
    const raw = await fs.readFile(path.join(trace.dir, "trace.json"), "utf8");
    const doc = JSON.parse(raw) as { entries: unknown[] };
    expect(doc.entries.length).toBe(2);
  });

  it("a failed type() also carries a hint", async () => {
    await computer.goto(fx.url("/index.html"));
    const ce = await computer
      .type("#emial", "x@y.com", { timeout: 800 }) // typo of #email
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(ce).toBeInstanceOf(ComputerError);
    // #email is the nearest match.
    expect((ce as ComputerError).suggestion).toMatch(/#email/);
  });

  it("failure on a page with no match still degrades gracefully (found summary, no crash)", async () => {
    await computer.goto(fx.url("/dashboard.html"));
    const ce = await computer
      .click("#totally-absent", { timeout: 800 })
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(ce).toBeInstanceOf(ComputerError);
    // dashboard has one link; found summary should still be present.
    expect((ce as ComputerError).found).toBeTruthy();
    expect((ce as ComputerError).message).toContain("replay:");
  });
});

/**
 * The one-click bug report: computer.bundle() -> a single self-contained
 * report.html with the failure error and its screenshot embedded.
 */
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient, ComputerError, writeTraceReport } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("trace bundle (bug report)", () => {
  let computer: ComputerClient;
  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("bundle() writes a self-contained HTML report with the error + embedded screenshot", async () => {
    await computer.goto(fx.url("/index.html"));
    await computer.click("#reveal"); // ok
    await computer.click("#submit", { timeout: 800 }).catch(() => {}); // fails -> screenshot + hint

    const out = await computer.bundle();
    expect(out).toMatch(/report\.html$/);

    const html = await fs.readFile(out, "utf8");
    // It's a real, self-contained HTML document.
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("doink trace report");
    // Every action shows up.
    expect(html).toContain("goto");
    expect(html).toContain("click");
    expect(html).toContain("FAIL");
    // The beautiful error is rendered verbatim, with the hint.
    expect(html).toContain("no element matched");
    expect(html).toContain("did you mean");
    // The failure screenshot is embedded inline (no external files needed).
    expect(html).toContain("data:image/png;base64,");
    // The raw machine-readable trace is embedded too.
    expect(html).toContain("raw trace.json");
  });

  it("writeTraceReport is exported and works standalone from a Trace", async () => {
    await computer.goto(fx.url("/index.html"));
    const out = await writeTraceReport(computer.trace(), `${computer.trace().dir}/custom.html`);
    expect(out).toMatch(/custom\.html$/);
    const html = await fs.readFile(out, "utf8");
    expect(html).toContain("doink trace report");
  });
});

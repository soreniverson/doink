/**
 * Regression guard for the truth-in-error class of bug (shipped because fixtures
 * only ever had single-match and zero-match cases). A selector matching MULTIPLE
 * elements must be reported as such — not as "no element matched".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient, ComputerError } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("multi-match truth-in-error", () => {
  let computer: ComputerClient;
  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("click on a selector matching 3 elements reports the TRUE count, not 0", async () => {
    await computer.goto(fx.url("/multi.html"));
    const err = await computer
      .click(".repeat-btn", { timeout: 2000 })
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(err).toBeInstanceOf(ComputerError);
    const ce = err as ComputerError;
    expect(ce.matched).toBe(3);
    // It must state the real count and NOT the old lie.
    expect(ce.message).toMatch(/matched 3 elements/);
    expect(ce.message).not.toMatch(/no element matched/);
    // It should point at the fix.
    expect(ce.message).toMatch(/nth/);
    expect(ce.fix).toBeTruthy();

    // And it must NOT have acted on any of them.
    const clicked = await computer.read({ selector: "#clicked" });
    expect(clicked).toBe("none");
  });

  it("click with { nth } is the escape hatch and hits the chosen match", async () => {
    await computer.goto(fx.url("/multi.html"));
    const res = await computer.click(".repeat-btn", { nth: 1 });
    expect(res.ok).toBe(true);
    const clicked = await computer.read({ selector: "#clicked" });
    expect(clicked).toBe("1");
  });

  it("matched-but-not-actionable (1 match, disabled) is NOT mislabeled as zero-match", async () => {
    await computer.goto(fx.url("/multi.html"));
    const err = await computer
      .click("#disabled-btn", { timeout: 1500 })
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(err).toBeInstanceOf(ComputerError);
    const ce = err as ComputerError;
    expect(ce.matched).toBe(1);
    expect(ce.message).toMatch(/matched 1 element but could not act/);
    expect(ce.message).not.toMatch(/no element matched/);
  });

  it("zero-match still says 'no element matched' + gives the did-you-mean hint (case a not regressed)", async () => {
    await computer.goto(fx.url("/index.html"));
    const err = await computer
      .click("#submit", { timeout: 1000 })
      .then(() => null)
      .catch((e) => e as ComputerError);

    expect(err).toBeInstanceOf(ComputerError);
    const ce = err as ComputerError;
    expect(ce.matched).toBe(0);
    expect(ce.message).toMatch(/no element matched/);
    expect(ce.suggestion).toMatch(/#login/);
    // The found line now tells the truth: 0 matched (not hardcoded, but real).
    expect(ce.found).toMatch(/0 matched/);
  });
});

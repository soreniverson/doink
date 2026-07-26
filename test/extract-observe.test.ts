/**
 * Phase 3 — deterministic extract (selector map) + observe (heuristic scan).
 * Both are free: no LLM, no tokens.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("extract + observe (deterministic)", () => {
  let computer: ComputerClient;

  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("extract pulls fields from a selector map", async () => {
    await computer.goto(fx.url("/index.html"));
    const data = await computer.extract<{ title: string; price: string; stock: string }>({
      title: ".product-title",
      price: ".price",
      stock: '[data-testid="stock"]',
    });
    expect(data.title).toBe("Monument Grotesk License");
    expect(data.price).toBe("$49.00");
    expect(data.stock).toBe("In stock");
  });

  it("extract yields null for selectors that don't match", async () => {
    await computer.goto(fx.url("/index.html"));
    const data = await computer.extract<{ nope: string | null }>({ nope: ".does-not-exist" });
    expect(data.nope).toBeNull();
  });

  it("observe lists interactive elements with stable selectors", async () => {
    await computer.goto(fx.url("/index.html"));
    const obs = await computer.observe();
    // email, password, login, reveal, load-async, dashboard-link, pricing-link, download-report
    expect(obs.length).toBeGreaterThanOrEqual(8);

    const login = obs.find((o) => o.selector === "#login");
    expect(login).toBeTruthy();
    expect(login?.role).toBe("button");

    const email = obs.find((o) => o.selector === "#email");
    expect(email?.role).toBe("textbox");
    expect(email?.name).toBe("Email");

    const link = obs.find((o) => o.selector === "#dashboard-link");
    expect(link?.role).toBe("link");
    expect(link?.attributes?.href).toBe("/dashboard.html");
  });

  it("observe scoped to a selector only returns that subtree", async () => {
    await computer.goto(fx.url("/pricing.html"));
    const obs = await computer.observe('[data-plan="pro"]');
    // Only the Pro plan's button.
    expect(obs.length).toBe(1);
    expect(obs[0]?.role).toBe("button");
    expect(obs[0]?.text).toContain("Choose Pro");
  });

  it("observed selectors actually resolve back to elements", async () => {
    await computer.goto(fx.url("/index.html"));
    const obs = await computer.observe();
    // Every observed selector should be clickable/typeable — click a link one.
    const target = obs.find((o) => o.role === "link" && o.selector === "#pricing-link");
    expect(target).toBeTruthy();
    await computer.click(target!.selector);
    await computer.waitFor("h1");
    const heading = await computer.read({ selector: "h1" });
    expect(heading).toBe("Pricing");
  });

  it("ai() extract/observe without llm throws a clear error", async () => {
    const { ai } = await import("../src/index.js");
    await computer.goto(fx.url("/index.html"));
    await expect(
      computer.extract(ai({ schema: { parse: (d) => d }, instruction: "the price" })),
    ).rejects.toThrow(/no `llm` was configured/);
    await expect(computer.observe(ai("the checkout controls"))).rejects.toThrow(
      /no `llm` was configured/,
    );
  });
});

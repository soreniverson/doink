/**
 * Phase 7 — the LangChain adapter. A LangChain agent completes a task on the
 * fixture site using these tools. Here we invoke the tools directly (the agent's
 * job is just to pick which tool + args), proving the toolkit is wired correctly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient } from "../src/index.js";
import { createComputerToolkit, ComputerToolkit } from "../src/adapters/langchain.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("LangChain adapter", () => {
  let computer: ComputerClient;
  beforeEach(() => {
    computer = makeClient();
  });
  afterEach(async () => {
    await computer.close();
  });

  it("produces one LangChain tool per primitive with name + schema", () => {
    const tools = createComputerToolkit(computer);
    expect(tools.length).toBe(9);
    const goto = tools.find((t) => t.name === "browser_goto");
    expect(goto).toBeTruthy();
    expect(goto?.description).toBeTruthy();
    // DynamicStructuredTool exposes a zod schema.
    expect(goto?.schema).toBeTruthy();
  });

  it("tools invoke against the client and return readable strings", async () => {
    const tools = createComputerToolkit(computer);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const goto = await byName.browser_goto!.invoke({ url: fx.url("/index.html") });
    expect(String(goto)).toContain("Navigated to");

    await byName.browser_type!.invoke({ target: "#email", text: "lc@example.com" });
    await byName.browser_click!.invoke({ target: "#reveal" });
    await byName.browser_wait_for!.invoke({ target: "#secret" });

    const read = await byName.browser_read!.invoke({ selector: "#secret" });
    expect(String(read)).toContain("The secret is 42.");

    const extract = await byName.browser_extract!.invoke({ fields: { price: ".price" } });
    expect(String(extract)).toContain("$49.00");

    const observe = await byName.browser_observe!.invoke({});
    expect(String(observe)).toContain("#login");
  });

  it("a bad selector returns the hint (so the agent can self-correct)", async () => {
    const tools = createComputerToolkit(computer);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    await byName.browser_goto!.invoke({ url: fx.url("/index.html") });

    const out = await byName.browser_click!.invoke({ target: "#submit", timeoutMs: 800 });
    expect(String(out)).toMatch(/#login/);
  });

  it("ComputerToolkit.getTools() returns the same tools", () => {
    const toolkit = new ComputerToolkit(computer);
    expect(toolkit.getTools().length).toBe(9);
    expect(toolkit.getTools().map((t) => t.name)).toContain("browser_extract");
  });
});

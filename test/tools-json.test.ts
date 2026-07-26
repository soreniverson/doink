/**
 * Phase 6 — the raw JSON tool-schema adapter + dispatcher.
 * A bare function-calling loop can drive the browser with no framework.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ComputerClient,
  computerToolSchemas,
  computerTools,
  createDispatcher,
} from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("tools-json adapter", () => {
  it("exposes one tool per primitive with JSON-Schema parameters", () => {
    const names = computerToolSchemas.map((t) => t.name);
    expect(names).toContain("browser_goto");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_extract");
    expect(names.length).toBe(9);
    for (const t of computerToolSchemas) {
      expect(t.parameters).toHaveProperty("type", "object");
      expect(typeof t.description).toBe("string");
    }
  });

  it("formats tools for OpenAI and Anthropic", () => {
    const openai = computerTools("openai");
    expect(openai[0]).toHaveProperty("type", "function");
    expect(openai[0]?.function).toHaveProperty("name");
    expect(openai[0]?.function).toHaveProperty("parameters");

    const anthropic = computerTools("anthropic");
    expect(anthropic[0]).toHaveProperty("name");
    expect(anthropic[0]).toHaveProperty("input_schema");
  });

  describe("dispatcher", () => {
    let computer: ComputerClient;
    beforeEach(() => {
      computer = makeClient();
    });
    afterEach(async () => {
      await computer.close();
    });

    it("executes a sequence of tool calls against the client", async () => {
      const dispatch = createDispatcher(computer);

      const goto = await dispatch({
        name: "browser_goto",
        arguments: JSON.stringify({ url: fx.url("/index.html") }),
      });
      expect(goto.ok).toBe(true);

      // OpenAI-style: arguments as a JSON string.
      const type = await dispatch({
        name: "browser_type",
        arguments: JSON.stringify({ target: "#email", text: "a@b.com" }),
      });
      expect(type.ok).toBe(true);

      // Anthropic-style: arguments as an object.
      const click = await dispatch({ name: "browser_click", arguments: { target: "#reveal" } });
      expect(click.ok).toBe(true);

      const wait = await dispatch({ name: "browser_wait_for", arguments: { target: "#secret" } });
      expect(wait.ok).toBe(true);

      const read = await dispatch({ name: "browser_read", arguments: { selector: "#secret" } });
      expect(read.ok).toBe(true);
      expect(read.content).toContain("The secret is 42.");

      const extract = await dispatch({
        name: "browser_extract",
        arguments: { fields: { price: ".price" } },
      });
      expect(extract.ok).toBe(true);
      expect(extract.data).toEqual({ price: "$49.00" });

      const observe = await dispatch({ name: "browser_observe", arguments: {} });
      expect(observe.ok).toBe(true);
      expect(observe.content).toContain("#login");
    });

    it("returns a non-throwing error result with the hint on a bad selector", async () => {
      const dispatch = createDispatcher(computer);
      await dispatch({ name: "browser_goto", arguments: { url: fx.url("/index.html") } });

      const res = await dispatch({
        name: "browser_click",
        arguments: { target: "#submit", timeoutMs: 800 },
      });
      expect(res.ok).toBe(false);
      // The model can read this and self-correct.
      expect(res.content).toMatch(/#login/);
      expect(res.error?.suggestion).toMatch(/#login/);
    });

    it("unknown tools return a clear error, not a throw", async () => {
      const dispatch = createDispatcher(computer);
      const res = await dispatch({ name: "browser_teleport", arguments: {} });
      expect(res.ok).toBe(false);
      expect(res.content).toContain("Unknown tool");
    });
  });
});

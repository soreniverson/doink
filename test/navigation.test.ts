/**
 * Part 2 — goto() must not silently "succeed" onto a 4xx/5xx error page.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerClient, ComputerError } from "../src/index.js";
import { makeClient, useFixture } from "./helpers.js";

const fx = useFixture();

describe("navigation status", () => {
  let computer: ComputerClient;
  afterEach(async () => {
    await computer?.close();
  });

  it("throws a ComputerError on a 404 landing by default", async () => {
    computer = makeClient();
    const err = await computer
      .goto(fx.url("/status/404"))
      .then(() => null)
      .catch((e) => e as ComputerError);
    expect(err).toBeInstanceOf(ComputerError);
    const ce = err as ComputerError;
    expect(ce.status).toBe(404);
    expect(ce.message).toMatch(/HTTP 404/);
    expect(ce.message).toMatch(/NavigationError/);
  });

  it("throws on a 500 landing too", async () => {
    computer = makeClient();
    const err = await computer
      .goto(fx.url("/status/500"))
      .then(() => null)
      .catch((e) => e as ComputerError);
    expect(err).toBeInstanceOf(ComputerError);
    expect((err as ComputerError).status).toBe(500);
  });

  it("with throwOnHttpError:false, surfaces the status on the result without throwing", async () => {
    computer = makeClient({ throwOnHttpError: false });
    const nav = await computer.goto(fx.url("/status/404"));
    expect(nav.ok).toBe(true);
    expect(nav.status).toBe(404);
  });

  it("a per-call override beats the client default", async () => {
    computer = makeClient(); // client default is throw
    const nav = await computer.goto(fx.url("/status/503"), { throwOnHttpError: false });
    expect(nav.status).toBe(503);
  });

  it("a normal 200 page is unaffected", async () => {
    computer = makeClient();
    const nav = await computer.goto(fx.url("/index.html"));
    expect(nav.ok).toBe(true);
    expect(nav.status).toBe(200);
  });
});

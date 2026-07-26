/**
 * Shared test scaffolding: one fixture server + one client per test file.
 */
import { afterAll, beforeAll } from "vitest";
import { ComputerClient } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "../fixtures/server.js";
import type { ComputerClientConfig } from "../src/types.js";

export interface TestContext {
  server: FixtureServer;
  /** Base URL of the fixture site. */
  url(pathname?: string): string;
}

/**
 * Spin up a fixture server for the whole file. Returns a context whose fields
 * are populated in beforeAll (so they're valid inside `it` blocks).
 */
export function useFixture(): TestContext {
  const ctx = { server: undefined as unknown as FixtureServer } as {
    server: FixtureServer;
    url(pathname?: string): string;
  };
  ctx.url = (pathname = "/index.html") =>
    `${ctx.server.url}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;

  beforeAll(async () => {
    ctx.server = await startFixtureServer();
  });
  afterAll(async () => {
    await ctx.server.close();
  });

  return ctx;
}

/** A client with tracing/cache pointed at a throwaway tmp dir. */
export function makeClient(overrides: ComputerClientConfig = {}): ComputerClient {
  return new ComputerClient({
    backend: "local",
    trace: { dir: "./.traces-test", ...(typeof overrides.trace === "object" ? overrides.trace : {}) },
    cache: false,
    ...overrides,
  });
}

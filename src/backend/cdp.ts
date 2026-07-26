/**
 * CDPBackend — connect to a browser running elsewhere over the Chrome DevTools
 * Protocol. Covers Browserless / Steel / Browserbase / self-hosted / a local
 * Chrome started with --remote-debugging-port. Rule #4: identical downstream.
 */
import { chromium } from "playwright";
import type { CDPBackendConfig } from "../types.js";
import type { Backend, BrowserSession } from "./types.js";

export class CDPBackend implements Backend {
  readonly kind = "cdp";
  private readonly cdpUrl: string;

  constructor(config: CDPBackendConfig) {
    if (!config.cdpUrl) {
      throw new Error("CDPBackend requires a cdpUrl (ws://, wss://, or http://).");
    }
    this.cdpUrl = config.cdpUrl;
  }

  async launch(): Promise<BrowserSession> {
    const browser = await chromium.connectOverCDP(this.cdpUrl);

    // Prefer a fresh, isolated context (so downloads work and state is clean);
    // fall back to the endpoint's existing context if it won't allow a new one.
    let context;
    let page;
    try {
      context = await browser.newContext({ acceptDownloads: true });
      page = await context.newPage();
    } catch {
      context = browser.contexts()[0] ?? (await browser.newContext());
      page = context.pages()[0] ?? (await context.newPage());
    }

    return {
      browser,
      context,
      page,
      close: async () => {
        // For a CDP connection, close() disconnects us; it does not necessarily
        // tear down the remote browser (that's the endpoint's business).
        try {
          await browser.close();
        } catch {
          /* already gone */
        }
      },
    };
  }
}

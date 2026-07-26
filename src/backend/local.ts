/**
 * LocalPlaywrightBackend — launches a local Chromium via Playwright.
 */
import { chromium } from "playwright";
import type { LocalBackendConfig } from "../types.js";
import type { Backend, BrowserSession } from "./types.js";

export class LocalPlaywrightBackend implements Backend {
  readonly kind = "local";
  private readonly config: LocalBackendConfig;

  constructor(config: LocalBackendConfig = {}) {
    this.config = config;
  }

  async launch(): Promise<BrowserSession> {
    const browser = await chromium.launch({
      headless: this.config.headless ?? true,
      args: this.config.args,
      slowMo: this.config.slowMo,
    });
    // acceptDownloads is required for download() to capture files.
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    return {
      browser,
      context,
      page,
      close: async () => {
        await browser.close();
      },
    };
  }
}

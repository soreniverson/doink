/**
 * The Backend seam. Rule #4: the backend never changes the API surface.
 *
 * A Backend produces a live Playwright session (browser + context + page).
 * Local and CDP implementations are identical downstream — the client code
 * doesn't know or care which one it got.
 */
import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Tear down whatever this backend created. */
  close(): Promise<void>;
}

export interface Backend {
  /** A short label used in traces (e.g. "local", "cdp"). */
  readonly kind: string;
  launch(): Promise<BrowserSession>;
}

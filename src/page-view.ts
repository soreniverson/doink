/**
 * PlaywrightPageView — the read-only handle passed to `waitFor` predicates.
 *
 * Deliberately tiny: enough to express a wait condition, nothing that mutates.
 */
import type { Page } from "playwright";
import type { PageView } from "./types.js";

export class PlaywrightPageView implements PageView {
  constructor(private readonly page: Page) {}

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title();
  }

  async text(selector?: string): Promise<string> {
    const target = selector ? this.page.locator(selector).first() : this.page.locator("body");
    try {
      return (await target.innerText()).trim();
    } catch {
      return "";
    }
  }

  count(selector: string): Promise<number> {
    return this.page.locator(selector).count();
  }

  async exists(selector: string): Promise<boolean> {
    return (await this.page.locator(selector).count()) > 0;
  }
}

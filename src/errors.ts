/**
 * ComputerError — never a raw Playwright stack trace, and never a LIE about
 * what happened. The rendered message tells the truth about which of three
 * things went wrong when acting on a target:
 *
 *   matched 0 elements  → "no element matched" + a did-you-mean hint
 *   matched N > 1        → "selector matched N elements — refusing to act" + fix
 *   matched 1, no act    → "matched 1 element but could not act" + the reason
 *
 * (Before, all three rendered as "no element matched / 0 matched" — which was
 * the exact opposite of the truth on the most common real case: N > 1.)
 */

export interface ComputerErrorFields {
  action: string;
  target: string;
  pageUrl: string;
  pageTitle: string;
  message?: string;
  screenshotPath?: string;
  domExcerpt?: string;
  suggestion?: string;
  tracePath: string;
  /** The underlying error, kept for the truly curious. */
  cause?: unknown;
  /** "8 buttons, 0 matched" style line (zero/single-match cases). */
  found?: string;
  /** How many elements the target selector actually matched (0, 1, or N). */
  matched?: number;
  /** The real underlying reason (e.g. "element is not visible") for a 1-match failure. */
  reason?: string;
  /** Actionable fix line (e.g. for the ambiguous multi-match case). */
  fix?: string;
  /** HTTP status, for a navigation-to-an-error-page failure. */
  status?: number;
}

const ACTION_LABEL: Record<string, string> = {
  click: "ClickError",
  type: "TypeError",
  download: "DownloadError",
  waitFor: "WaitError",
  extract: "ExtractError",
  observe: "ObserveError",
  goto: "NavigationError",
  screenshot: "ScreenshotError",
  read: "ReadError",
};

const ACTING = new Set(["click", "type", "download"]);

export class ComputerError extends Error {
  readonly action: string;
  readonly target: string;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly screenshotPath?: string;
  readonly domExcerpt?: string;
  readonly suggestion?: string;
  readonly tracePath: string;
  readonly found?: string;
  readonly matched?: number;
  readonly reason?: string;
  readonly fix?: string;
  readonly status?: number;

  constructor(fields: ComputerErrorFields) {
    super(fields.message ?? defaultMessage(fields), { cause: fields.cause });
    this.name = "ComputerError";
    this.action = fields.action;
    this.target = fields.target;
    this.pageUrl = fields.pageUrl;
    this.pageTitle = fields.pageTitle;
    this.screenshotPath = fields.screenshotPath;
    this.domExcerpt = fields.domExcerpt;
    this.suggestion = fields.suggestion;
    this.tracePath = fields.tracePath;
    this.found = fields.found;
    this.matched = fields.matched;
    this.reason = fields.reason;
    this.fix = fields.fix;
    this.status = fields.status;
    // Rebuild the message so the pretty multi-line form is what users see.
    this.message = this.format();
    Object.setPrototypeOf(this, ComputerError.prototype);
  }

  private headline(): string {
    if (this.status !== undefined) {
      return `${label("goto")}: '${this.target}' returned HTTP ${this.status}`;
    }
    if (ACTING.has(this.action) && this.matched !== undefined) {
      if (this.matched > 1) {
        return `${label(this.action)}: selector matched ${this.matched} elements — refusing to act ambiguously`;
      }
      if (this.matched === 1) {
        return `${label(this.action)}: matched 1 element but could not act on '${this.target}'`;
      }
      return `${label(this.action)}: no element matched '${this.target}'`;
    }
    return defaultMessage({ action: this.action, target: this.target });
  }

  /**
   * The obsessive, aligned, multi-line failure report:
   *
   *   ClickError: selector matched 5 elements — refusing to act ambiguously
   *     page:    https://react.dev/  ("React")
   *     matched: 5 elements for 'a[href="/learn"]'
   *     fix:     narrow the selector, or pass { nth: 0 } to act on a specific match
   *     dom:     <up to 3 of the matched elements>
   *     shot:    ...
   *     replay:  ...
   */
  format(): string {
    const lines: string[] = [this.headline()];
    const page = this.pageTitle ? `${this.pageUrl}  ("${this.pageTitle}")` : this.pageUrl;
    lines.push(pad("page:", page));

    if (this.matched !== undefined && this.matched > 1) {
      lines.push(pad("matched:", `${this.matched} elements for '${this.target}'`));
    } else if (this.found) {
      lines.push(pad("found:", this.found));
    }
    if (this.suggestion) lines.push(pad("hint:", this.suggestion));
    if (this.reason) lines.push(pad("reason:", this.reason));
    if (this.fix) lines.push(pad("fix:", this.fix));
    if (this.domExcerpt) {
      const excerpt = this.domExcerpt.split("\n").slice(0, 6).join("\n" + " ".repeat(11));
      lines.push(pad("dom:", excerpt));
    }
    if (this.screenshotPath) lines.push(pad("shot:", this.screenshotPath));
    lines.push(pad("replay:", this.tracePath));
    return lines.join("\n");
  }

  /** A structured form, handy for logs/adapters that want JSON. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      action: this.action,
      target: this.target,
      pageUrl: this.pageUrl,
      pageTitle: this.pageTitle,
      matched: this.matched,
      suggestion: this.suggestion,
      found: this.found,
      reason: this.reason,
      fix: this.fix,
      status: this.status,
      screenshotPath: this.screenshotPath,
      domExcerpt: this.domExcerpt,
      tracePath: this.tracePath,
    };
  }
}

/**
 * Thrown for misconfiguration — most importantly, calling `ai(...)` when no
 * `llm` was configured. Clear and actionable, never a stack trace.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

function label(action: string): string {
  return ACTION_LABEL[action] ?? `${action}Error`;
}

function defaultMessage(fields: { action: string; target: string }): string {
  const verb: Record<string, string> = {
    click: "ClickError: no element matched",
    type: "TypeError: no element matched",
    download: "DownloadError: no element matched",
    waitFor: "WaitError: condition never became true for",
    extract: "ExtractError: could not extract",
    observe: "ObserveError: could not observe",
    goto: "NavigationError: could not navigate to",
    screenshot: "ScreenshotError: could not capture",
    read: "ReadError: could not read",
  };
  const prefix = verb[fields.action] ?? `${fields.action}Error:`;
  return `${prefix} '${fields.target}'`;
}

function pad(labelText: string, value: string): string {
  return `  ${labelText.padEnd(8)} ${value}`;
}

/**
 * Tracer — rule #5: every action is traced, from commit one.
 *
 * Each action appends a structured record to an in-memory trace and to an
 * append-only trace.json on disk. Screenshots and DOM excerpts (Phase 2) land
 * next to it. The whole session is replayable.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Trace, TraceConfig, TraceEntry } from "../types.js";

export interface ResolvedTraceConfig {
  enabled: boolean;
  dir: string;
  screenshotOnFailure: boolean;
  captureDomOnFailure: boolean;
}

export function resolveTraceConfig(config: TraceConfig | false | undefined): ResolvedTraceConfig {
  if (config === false) {
    return {
      enabled: false,
      dir: "./.traces",
      screenshotOnFailure: false,
      captureDomOnFailure: false,
    };
  }
  return {
    enabled: config?.enabled ?? true,
    dir: config?.dir ?? "./.traces",
    screenshotOnFailure: config?.screenshotOnFailure ?? true,
    captureDomOnFailure: config?.captureDomOnFailure ?? true,
  };
}

/** Filesystem-safe ISO timestamp: 2026-07-25T18-04-02-123Z */
function stamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

export class Tracer {
  readonly config: ResolvedTraceConfig;
  readonly sessionId: string;
  readonly dir: string;
  readonly startedAt: string;
  private readonly entries: TraceEntry[] = [];
  private dirReady = false;
  /** Serializes disk writes so trace.json never interleaves. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: ResolvedTraceConfig) {
    this.config = config;
    this.startedAt = new Date().toISOString();
    this.sessionId = stamp();
    this.dir = path.resolve(config.dir, this.sessionId);
  }

  /** Path to the replayable trace file for this session. */
  get tracePath(): string {
    return path.join(this.dir, "trace.json");
  }

  getTrace(): Trace {
    return {
      sessionId: this.sessionId,
      dir: this.dir,
      startedAt: this.startedAt,
      // Return a copy so callers can't mutate our record.
      entries: this.entries.map((e) => ({ ...e })),
    };
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.dirReady = true;
  }

  /** Append a record. Written to disk best-effort; never throws into an action. */
  async record(entry: Omit<TraceEntry, "ts"> & { ts?: string }): Promise<void> {
    const full: TraceEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry };
    this.entries.push(full);
    if (!this.config.enabled) return;
    this.writeChain = this.writeChain.then(() => this.flush()).catch(() => {});
    await this.writeChain;
  }

  private async flush(): Promise<void> {
    await this.ensureDir();
    const doc: Trace = {
      sessionId: this.sessionId,
      dir: this.dir,
      startedAt: this.startedAt,
      entries: this.entries,
    };
    await fs.writeFile(this.tracePath, JSON.stringify(doc, null, 2), "utf8");
  }

  /** Save a screenshot buffer into the session dir; returns its path. */
  async saveScreenshot(buffer: Buffer, label: string): Promise<string | undefined> {
    if (!this.config.enabled) return undefined;
    try {
      await this.ensureDir();
      const safe = label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);
      const file = path.join(this.dir, `${this.entries.length}-${safe}.png`);
      await fs.writeFile(file, buffer);
      return file;
    } catch {
      return undefined;
    }
  }

  /** Save a text artifact (e.g. a DOM excerpt) into the session dir. */
  async saveText(name: string, content: string): Promise<string | undefined> {
    if (!this.config.enabled) return undefined;
    try {
      await this.ensureDir();
      const safe = name.replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 60);
      const file = path.join(this.dir, safe);
      await fs.writeFile(file, content, "utf8");
      return file;
    } catch {
      return undefined;
    }
  }
}

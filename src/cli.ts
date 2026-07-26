#!/usr/bin/env node
/**
 * doink CLI — bundle a trace session into a single shareable HTML bug report.
 *
 *   npx doink report [trace-dir]
 *
 * With no dir, it grabs the most recent session under ./.traces. So when a run
 * breaks, a tester runs `npx doink report` and sends the one file it prints.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeTraceReport } from "./trace/report.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve to a session dir containing trace.json (direct, or newest under a parent). */
async function findSessionDir(input?: string): Promise<string | null> {
  const abs = path.resolve(input ?? "./.traces");
  if (await exists(path.join(abs, "trace.json"))) return abs;

  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
  const candidates: { dir: string; mtime: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const tj = path.join(abs, e.name, "trace.json");
    if (await exists(tj)) candidates.push({ dir: path.join(abs, e.name), mtime: (await fs.stat(tj)).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.dir ?? null;
}

const USAGE = `doink — a deterministic, agent-shaped browser SDK

Usage:
  doink report [trace-dir]   Bundle a trace session into a single shareable
                             report.html (screenshots embedded). Defaults to the
                             most recent session under ./.traces.`;

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return;
  }
  if (cmd !== "report") {
    console.error(`Unknown command "${cmd}".\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const dir = await findSessionDir(arg);
  if (!dir) {
    console.error(`No trace.json found under ${path.resolve(arg ?? "./.traces")}.`);
    console.error("Run something with doink first (traces are on by default), then retry.");
    process.exitCode = 1;
    return;
  }

  const trace = JSON.parse(await fs.readFile(path.join(dir, "trace.json"), "utf8"));
  trace.dir = dir; // resolve embedded screenshots relative to where the file actually is
  const out = await writeTraceReport(trace, path.join(dir, "report.html"));
  console.log(`Wrote ${out}`);
  console.log("Open it, or send that single file — it's self-contained.");
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exitCode = 1;
});

/**
 * Orchestrator. Runs each selected site twice, writes results.json + REPORT.md.
 *
 *   npx tsx validation/run.ts                # all sites
 *   SITES=1-4 npx tsx validation/run.ts      # a range
 *   SITES=5,15,25 npx tsx validation/run.ts  # a set
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CACHE_DIR, RESULTS_DIR, TRACE_ROOT, makeLLM, runSite, type SiteResult } from "./lib.js";
import { SITES } from "./sites.js";
import { writeReport } from "./report.js";

function select(filter: string | undefined) {
  if (!filter) return SITES;
  const ids = new Set<number>();
  for (const part of filter.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    for (let i = lo; i <= hi; i++) ids.add(i);
  }
  return SITES.filter((s) => ids.has(s.id));
}

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(TRACE_ROOT, { recursive: true });

  const llm = makeLLM();
  const specs = select(process.env.SITES);

  console.log(
    `LLM: ${llm.enabled ? `enabled (${llm.model})` : "DISABLED (no ANTHROPIC_API_KEY) — ai/cache checks SKIPPED"}`,
  );
  console.log(`Running ${specs.length} site(s), twice each...\n`);

  const results: SiteResult[] = [];
  for (const spec of specs) {
    process.stdout.write(`[${spec.id}] ${spec.name} (${spec.group}) ... `);
    const t0 = Date.now();
    const r = await runSite(spec, llm);
    results.push(r);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const fails =
      r.run1.filter((a) => a.outcome === "failed").length +
      r.run2.filter((a) => a.outcome === "failed").length;
    console.log(
      `${r.verdict}  (${secs}s, llm r1=${r.llmRun1} r2=${r.llmRun2}, ${fails} failed action(s))`,
    );
  }

  const jsonPath = path.join(RESULTS_DIR, "results.json");
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        llm: { enabled: llm.enabled, model: llm.model, totalCalls: llm.count() },
        siteCount: results.length,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeReport(results, llm, path.join(RESULTS_DIR, "REPORT.md"));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${path.join(RESULTS_DIR, "REPORT.md")}`);
}

main().catch((err) => {
  // Even the orchestrator must not die silently — but it should never get here.
  console.error("FATAL orchestrator error:", err);
  process.exit(1);
});

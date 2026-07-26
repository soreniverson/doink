/**
 * Regenerate REPORT.md from an existing results.json (no re-crawl).
 *   npx tsx validation/regen-report.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { RESULTS_DIR, type LLMHarness, type SiteResult } from "./lib.js";
import { writeReport } from "./report.js";

async function main() {
  const raw = JSON.parse(await fs.readFile(path.join(RESULTS_DIR, "results.json"), "utf8")) as {
    llm: { enabled: boolean; model?: string; totalCalls: number };
    results: SiteResult[];
  };
  const llm: LLMHarness = {
    enabled: raw.llm.enabled,
    model: raw.llm.model,
    count: () => raw.llm.totalCalls,
  };
  await writeReport(raw.results, llm, path.join(RESULTS_DIR, "REPORT.md"));
  console.log("Regenerated REPORT.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

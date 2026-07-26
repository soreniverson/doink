/**
 * examples/ai.ts — the whole cost story: pay once, then free.
 *
 *   npm run example:ai
 *
 * Uses a MOCK provider (a counting function) so it runs with no API key. Swap
 * `provider` for { provider: "anthropic", apiKey: ... } to use a real model —
 * the rest of the code is identical.
 *
 * Run it TWICE: the second process makes ZERO LLM calls (the committed cache
 * from the first run resolves everything for free).
 */
import { ComputerClient, ai } from "../src/index.js";
import { startFixtureServer } from "../fixtures/server.js";
import type { LLMResolveInput, LLMResolveOutput } from "../src/types.js";

let llmCalls = 0;

// A stand-in for a real LLM. In reality this would look at input.snapshot +
// input.screenshot and return a selector. Here we just count and answer.
const provider = async (input: LLMResolveInput): Promise<LLMResolveOutput> => {
  llmCalls += 1;
  console.log(`  [LLM] resolving ${input.kind}: "${input.instruction}"  (paid call #${llmCalls})`);
  if (input.kind === "locate") return { selector: "#login" };
  if (input.kind === "extract") return { selectorMap: { title: ".product-title", price: ".price" } };
  if (input.kind === "observe") return { selectors: ["#login", "#reveal"] };
  return {};
};

async function main() {
  // A FIXED port so the URL (and thus the page signature) is stable across
  // runs — that's what makes the cross-process cache hit on the second run.
  const site = await startFixtureServer(4599);
  const computer = new ComputerClient({
    backend: "local",
    trace: { dir: "./.traces" },
    llm: { provider },
    cache: { path: "./.computer-cache.json" }, // commit this = free reruns for the team
  });

  try {
    await computer.goto(`${site.url}/index.html`);

    console.log("\nFirst ai() call:");
    const r1 = await computer.click(ai("the blue login button"));
    console.log(`  -> selector ${r1.target.selector}, resolvedByLLM=${r1.resolvedByLLM}, cached=${r1.cached}`);

    await computer.goto(`${site.url}/index.html`);
    console.log("\nSecond identical ai() call:");
    const r2 = await computer.click(ai("the blue login button"));
    console.log(`  -> selector ${r2.target.selector}, resolvedByLLM=${r2.resolvedByLLM}, cached=${r2.cached}`);

    console.log(`\nTotal LLM calls this run: ${llmCalls}`);
    console.log(
      llmCalls === 0
        ? "ZERO LLM calls — the whole run was served from the committed cache."
        : "Paid once; the identical call was FREE. Run again for zero calls.",
    );
  } finally {
    await computer.close();
    await site.close();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

/**
 * A complete, runnable example against a real public site — no API key needed.
 *
 *   npm install
 *   npx playwright install chromium
 *   npx tsx examples/scrape.ts
 *
 * (A consumer of the published package would instead write:
 *    import { ComputerClient } from "doink";
 *  — here we import from source so the example runs inside the repo.)
 */
import { ComputerClient } from "../src/index.js";

async function main() {
  const computer = new ComputerClient({ backend: "local" });

  try {
    await computer.goto("https://quotes.toscrape.com/");

    // Deterministic, free extraction — a selector map, never an LLM.
    const first = await computer.extract<{ quote: string; author: string; firstTag: string }>({
      quote: ".quote .text",
      author: ".quote .author",
      firstTag: ".quote .tags a.tag",
    });
    console.log("First quote on the page:");
    console.log(`  ${first.quote}`);
    console.log(`  — ${first.author}  (#${first.firstTag})`);

    // "What can I do on this page?" — a free heuristic scan.
    const actions = await computer.observe();
    console.log(`\nobserve(): ${actions.length} interactive elements found.`);

    // Follow a link deterministically, then read the new page.
    await computer.click("li.next a");
    await computer.waitFor(".quote");
    const page2 = await computer.read({ selector: ".quote .author" });
    console.log(`\nAfter clicking "Next", first author on page 2: ${page2}`);

    const shot = await computer.screenshot();
    console.log(`\nscreenshot: ${shot.length} bytes (also saved under ./.traces)`);
    console.log(`trace: ${computer.trace().entries.length} actions recorded in ${computer.trace().dir}`);
  } finally {
    await computer.close();
  }
}

main().catch((err) => {
  // On failure you get an obsessive, replayable ComputerError — try changing a
  // selector above to something wrong (e.g. ".quotes") to see the "did you mean" hint.
  console.error(String(err));
  process.exit(1);
});

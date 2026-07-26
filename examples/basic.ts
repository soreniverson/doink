/**
 * examples/basic.ts — drive the fixture site end to end, deterministically.
 *
 *   npm run example
 *
 * Every call here is free: plain-string selectors, zero LLM, zero tokens.
 */
import { ComputerClient } from "../src/index.js";
import { startFixtureServer } from "../fixtures/server.js";

async function main() {
  const site = await startFixtureServer();
  const computer = new ComputerClient({
    backend: "local",
    trace: { dir: "./.traces" },
  });

  try {
    const nav = await computer.goto(`${site.url}/index.html`);
    console.log(`goto -> ${nav.url} (${nav.status}) in ${nav.durationMs}ms`);

    await computer.type("#email", "me@example.com");
    await computer.type("#password", "hunter2");
    console.log("typed credentials");

    // Reveal a hidden element and wait for it, then read it.
    await computer.click("#reveal");
    await computer.waitFor("#secret");
    const secret = await computer.read({ selector: "#secret" });
    console.log(`secret text: ${secret}`);

    // Wait on a predicate (async status flips after 400ms).
    await computer.click("#load-async");
    await computer.waitFor(async (page) => (await page.text("#async-status")) === "ready");
    console.log("async became ready");

    // Navigate via a link.
    await computer.click("#dashboard-link");
    await computer.waitFor("#dashboard-title");
    const title = await computer.read({ selector: "#dashboard-title" });
    console.log(`dashboard title: ${title}`);

    // Screenshot to the trace dir.
    const shot = await computer.screenshot();
    console.log(`screenshot: ${shot.length} bytes`);

    const trace = computer.trace();
    console.log(`\ntrace: ${trace.entries.length} actions -> ${trace.dir}`);
  } finally {
    await computer.close();
    await site.close();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

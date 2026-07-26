/**
 * examples/agent-loop.ts — a bare function-calling loop drives the browser.
 *
 *   npm run example:agent
 *
 * A real agent would send `computerTools("openai")` to the model and feed each
 * tool_call to the dispatcher. Here we simulate the model with a fixed script of
 * tool calls (no API key needed) so you can see the adapter + dispatcher working
 * end to end, including a self-correcting error hint.
 */
import { ComputerClient, computerTools, createDispatcher, type ToolCall } from "../src/index.js";
import { startFixtureServer } from "../fixtures/server.js";

async function main() {
  const site = await startFixtureServer();
  const computer = new ComputerClient({ trace: { dir: "./.traces" }, cache: false });
  const dispatch = createDispatcher(computer);

  console.log(`Exposing ${computerTools("openai").length} tools to the "model".\n`);

  // What a model would emit as tool_calls (arguments as JSON strings, OpenAI-style).
  const script: ToolCall[] = [
    { name: "browser_goto", arguments: JSON.stringify({ url: `${site.url}/index.html` }) },
    { name: "browser_observe", arguments: "{}" },
    // A wrong selector — the dispatcher returns a hint the model could act on.
    { name: "browser_click", arguments: JSON.stringify({ target: "#submit" }) },
    // The corrected click.
    { name: "browser_type", arguments: JSON.stringify({ target: "#email", text: "agent@example.com" }) },
    { name: "browser_click", arguments: JSON.stringify({ target: "#reveal" }) },
    { name: "browser_wait_for", arguments: JSON.stringify({ target: "#secret" }) },
    { name: "browser_read", arguments: JSON.stringify({ selector: "#secret" }) },
    { name: "browser_extract", arguments: JSON.stringify({ fields: { price: ".price" } }) },
  ];

  try {
    for (const call of script) {
      const result = await dispatch(call);
      const tag = result.ok ? "ok " : "ERR";
      console.log(`[${tag}] ${call.name}: ${result.content.replace(/\n/g, " ")}`.slice(0, 160));
    }
  } finally {
    await computer.close();
    await site.close();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

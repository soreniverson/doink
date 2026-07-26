# doink

A deterministic, agent-shaped browser SDK over Playwright: **plain selectors are free and never call an LLM**, the LLM path is an explicit, cached `ai()` call, and **every failure is an obsessive, replayable error that tells you exactly what to fix.**

## Install

```bash
npm install doink
npx playwright install chromium   # one-time: the browser doink drives
```

## A ten-line example (real site, no API key)

```ts
import { ComputerClient } from "doink";

const computer = new ComputerClient({ backend: "local" });

await computer.goto("https://quotes.toscrape.com/");
const first = await computer.extract<{ quote: string; author: string }>({ quote: ".quote .text", author: ".quote .author" });
console.log(first.author, "—", first.quote);   // Albert Einstein — "The world as we have created it..."

await computer.click("li.next a");              // free, deterministic — never spends a token
await computer.waitFor(".quote");
await computer.close();
```

Every call above is deterministic and free. A plain string is *always* a selector; it never calls a model. Run it yourself: [`examples/scrape.ts`](examples/scrape.ts).

## The natural-language path is explicit and cached

The only way to invoke an LLM is to wrap a target in `ai(...)`. A reviewer can grep for `ai(` and see every dollar. The first call for a given (page-signature, instruction) pays one model call and caches the resolved selector; every rerun is free, and a stale cached selector self-heals.

```ts
import { ComputerClient, ai } from "doink";

const computer = new ComputerClient({
  backend: "local",
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY }, // bring your own key
});

await computer.goto("https://example.com/login");
await computer.click("#login");                       // free, deterministic
await computer.type(ai("the email field"), "me@x.com"); // opt-in LLM, cached after the first run
await computer.click(ai("the blue sign-in button"));  // second run: 0 model calls
```

## The error output is the point

When a selector breaks, you don't get a raw Playwright stack — you get a diagnosis. These are pasted **verbatim** from real public sites.

A selector that matches **more than one** element (the most common real bug — nav links, list items, repeated cards) tells you the truth and how to fix it:

```
ClickError: selector matched 10 elements — refusing to act ambiguously
  page:    https://quotes.toscrape.com/  ("Quotes to Scrape")
  matched: 10 elements for '.author'
  fix:     narrow the selector, or pass { nth: 0 } to act on a specific match
  dom:     <small class="author" itemprop="author">Albert Einstein</small>
           <small class="author" itemprop="author">J.K. Rowling</small>
           <small class="author" itemprop="author">Albert Einstein</small>
  shot:    ./.traces/2026-07-26T07-31-07-329Z/1-click-fail.png
  replay:  ./.traces/2026-07-26T07-31-07-329Z/trace.json
```

A selector that matches **nothing** scans the page and suggests the one you probably meant:

```
ClickError: no element matched '#submit'
  page:    https://www.saucedemo.com/  ("Swag Labs")
  found:   1 buttons, 0 matched '#submit'
  hint:    did you mean '#login-button'? (1 match)
  dom:     button   #login-button
             <input class="submit-button btn_action" data-test="login-button" id="login-button" type="submit" value="Login" name="login-button" style="">
           textbox  #password
             <input class="input_error form_input" placeholder="Password" data-test="password" id="password" ... type="password" ...>
           textbox  #user-name
             <input class="input_error form_input" placeholder="Username" data-test="username" id="user-name" ... type="text" ...>
  shot:    ./.traces/2026-07-26T07-31-09-244Z/1-click-fail.png
  replay:  ./.traces/2026-07-26T07-31-09-244Z/trace.json
```

Every action — success or failure — appends to a replayable `trace.json`; failures also capture a screenshot and a DOM excerpt automatically.

## The nine primitives

`goto` · `click` · `type` · `read` · `extract` · `observe` · `screenshot` · `download` · `waitFor` — plus `close()` and `trace()`. Each takes a plain selector (free) or an `ai("…")` target (explicit, cached). `extract` and `observe` also take a selector map / heuristic scan for free.

## Swap the backend with one line

```ts
new ComputerClient({ backend: "local" });                                  // local Chromium
new ComputerClient({ backend: { cdpUrl: "wss://connect.browserbase.com?apiKey=…" } }); // Browserless / Steel / Browserbase / self-hosted
```

Everything downstream — the primitives, the traces, the hints — is identical.

## Drive it from an agent

```ts
// Raw function-calling tools (any framework, or none):
import { ComputerClient, computerTools, createDispatcher } from "doink";
const tools = computerTools("openai");            // or "anthropic"
const dispatch = createDispatcher(new ComputerClient());
// feed each model tool_call to dispatch(); results (incl. the "did you mean" hint) go back to the model.

// LangChain:
import { createComputerToolkit } from "doink/langchain";
const toolkit = createComputerToolkit(new ComputerClient());
```

## License

MIT © Soren Iverson

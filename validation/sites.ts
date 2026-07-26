/**
 * The 25 sites, grouped by what each one probes. Each `run` is executed verbatim
 * on run 1 (populate cache) and run 2 (prove pay-once). Actions are realistic but
 * minimal. Selectors reflect the real DOM at authoring time; where a site has
 * rotted, the harness records the crack — that's the data.
 */
import type { SiteSpec } from "./lib.js";

export const SITES: SiteSpec[] = [
  // ===== DETERMINISTIC SANITY (the free path must work) =====================
  {
    id: 1,
    group: "deterministic",
    name: "books.toscrape",
    url: "https://books.toscrape.com/",
    probes: "selector-map extraction of titles + prices",
    run: async (r) => {
      await r.goto("https://books.toscrape.com/");
      await r.extract(
        { title: "article.product_pod h3 a", price: "article.product_pod .price_color" },
        "book title+price",
      );
      await r.observe();
    },
  },
  {
    id: 2,
    group: "deterministic",
    name: "quotes.toscrape",
    url: "https://quotes.toscrape.com/",
    probes: "repeated quote/author/tags list extraction",
    run: async (r) => {
      await r.goto("https://quotes.toscrape.com/");
      await r.extract(
        { quote: ".quote .text", author: ".quote .author", tag: ".quote .tags a.tag" },
        "quote/author/tag",
      );
      await r.observe();
    },
  },
  {
    id: 3,
    group: "deterministic",
    name: "scrapethissite.simple",
    url: "https://www.scrapethissite.com/pages/simple/",
    probes: "country data extraction",
    run: async (r) => {
      await r.goto("https://www.scrapethissite.com/pages/simple/");
      await r.extract(
        {
          country: ".country-name",
          capital: ".country-capital",
          population: ".country-population",
        },
        "country/capital/population",
      );
    },
  },
  {
    id: 4,
    group: "deterministic",
    name: "webscraper.ecommerce",
    url: "https://webscraper.io/test-sites/e-commerce/allinone",
    probes: "product grid extraction",
    run: async (r) => {
      await r.goto("https://webscraper.io/test-sites/e-commerce/allinone");
      await r.extract({ product: "a.title", price: ".price, .caption h4" }, "product+price");
      await r.observe();
    },
  },

  // ===== LOGIN FLOWS ========================================================
  {
    id: 5,
    group: "login",
    name: "saucedemo",
    url: "https://www.saucedemo.com/",
    probes: "type+click+post-submit wait; wrong-selector hint on a real DOM",
    run: async (r) => {
      await r.goto("https://www.saucedemo.com/");
      // Deliberate wrong selector — the real button is #login-button.
      await r.wrongSelector("#submit");
      await r.type("#user-name", "standard_user");
      await r.type("#password", "secret_sauce");
      await r.click("#login-button");
      await r.waitFor(".inventory_list");
      await r.extract({ firstItem: ".inventory_item_name" }, "first product");
    },
  },
  {
    id: 6,
    group: "login",
    name: "herokuapp.login",
    url: "https://the-internet.herokuapp.com/login",
    probes: "login + success banner assertion",
    run: async (r) => {
      await r.goto("https://the-internet.herokuapp.com/login");
      await r.type("#username", "tomsmith");
      await r.type("#password", "SuperSecretPassword!");
      await r.click("button[type='submit']");
      await r.waitFor("#flash.success");
      await r.extract({ banner: "#flash" }, "success banner");
    },
  },
  {
    id: 7,
    group: "login",
    name: "expandtesting.login",
    url: "https://practice.expandtesting.com/login",
    probes: "login + post-login state",
    run: async (r) => {
      await r.goto("https://practice.expandtesting.com/login");
      await r.type("#username", "practice");
      await r.type("#password", "SuperSecretPassword!");
      await r.click("button[type='submit']");
      await r.waitFor("#flash");
      await r.extract({ flash: "#flash" }, "post-login flash");
    },
  },
  {
    id: 8,
    group: "login",
    name: "demoqa.login",
    url: "https://demoqa.com/login",
    probes: "React login; hydration timing (type/click on hydrated inputs)",
    run: async (r) => {
      await r.goto("https://demoqa.com/login");
      await r.type("#userName", "validation_probe");
      await r.type("#password", "NotARealPassword1!");
      await r.click("#login");
      // Login will fail (dummy creds) — we care that the React inputs accepted
      // input and the button was clickable after hydration.
      await r.observe();
    },
  },

  // ===== COOKIE / CONSENT WALLS =============================================
  {
    id: 9,
    group: "consent",
    name: "bbc",
    url: "https://www.bbc.com/",
    probes: "ai(accept cookies) then read a headline; consent may block free path",
    run: async (r) => {
      await r.goto("https://www.bbc.com/");
      await r.clickAI("accept all cookies");
      await r.observe();
      await r.extract({ headline: "h1, h2, [data-testid='card-headline']" }, "a headline");
    },
  },
  {
    id: 10,
    group: "consent",
    name: "guardian",
    url: "https://www.theguardian.com/",
    probes: "consent may live in an iframe (SDK scans main frame only)",
    run: async (r) => {
      await r.goto("https://www.theguardian.com/");
      await r.clickAI("dismiss or accept the cookie consent banner");
      await r.observe();
      await r.extract({ headline: "h1, a[data-link-name] h3" }, "a headline");
    },
  },
  {
    id: 11,
    group: "consent",
    name: "cnn",
    url: "https://www.cnn.com/",
    probes: "consent + ad slots shifting layout; signature stability",
    run: async (r) => {
      await r.goto("https://www.cnn.com/");
      await r.clickAI("accept cookies");
      await r.observe();
      await r.extract({ headline: "h1, .container__headline, [data-editable='headline']" }, "a headline");
    },
  },
  {
    id: 12,
    group: "consent",
    name: "booking",
    url: "https://www.booking.com/",
    probes: "stacked consent/geo popups; expected-hostile",
    run: async (r) => {
      await r.goto("https://www.booking.com/");
      await r.clickAI("dismiss the cookie or sign-in popup");
      await r.observe();
      await r.extract({ heading: "h1" }, "page heading");
    },
  },

  // ===== LATE-MOUNTING / DYNAMIC ===========================================
  {
    id: 13,
    group: "late-mount",
    name: "uitp.loaddelay",
    url: "http://uitestingplayground.com/loaddelay",
    probes: "waitFor a delayed button, then click it",
    run: async (r) => {
      await r.goto("http://uitestingplayground.com/loaddelay");
      await r.waitFor("button.btn-primary");
      await r.click("button.btn-primary");
    },
  },
  {
    id: 14,
    group: "late-mount",
    name: "uitp.ajax",
    url: "http://uitestingplayground.com/ajax",
    probes: "click trigger, wait for late success text (~15s)",
    run: async (r) => {
      await r.goto("http://uitestingplayground.com/ajax");
      await r.click("#ajaxButton");
      await r.waitFor(".bg-success"); // deterministic late-mount
      await r.waitForAI("the success confirmation text"); // ai variant (skipped w/o key)
      await r.extract({ msg: ".bg-success" }, "success text");
    },
  },
  {
    id: 15,
    group: "late-mount",
    name: "uitp.dynamicid",
    url: "http://uitestingplayground.com/dynamicid",
    probes: "CACHE NEMESIS — id regenerates each load; self-heal must fire (not throw)",
    run: async (r) => {
      await r.goto("http://uitestingplayground.com/dynamicid");
      await r.click("button.btn-primary"); // stable-by-class deterministic click
      await r.clickAI("the button with the dynamic id"); // self-heal test (skipped w/o key)
    },
  },
  {
    id: 16,
    group: "late-mount",
    name: "herokuapp.dynload2",
    url: "https://the-internet.herokuapp.com/dynamic_loading/2",
    probes: "start, waitFor the rendered element",
    run: async (r) => {
      await r.goto("https://the-internet.herokuapp.com/dynamic_loading/2");
      await r.click("#start button");
      await r.waitFor("#finish");
      await r.extract({ text: "#finish" }, "rendered text");
    },
  },
  {
    id: 17,
    group: "late-mount",
    name: "demoqa.dynprops",
    url: "https://demoqa.com/dynamic-properties",
    probes: "wait on an element that appears after a timer",
    run: async (r) => {
      await r.goto("https://demoqa.com/dynamic-properties");
      await r.waitFor("#visibleAfter");
      await r.click("#visibleAfter");
    },
  },

  // ===== SPAs (client-side nav swaps DOM without a full load) ================
  {
    id: 18,
    group: "spa",
    name: "react.dev",
    url: "https://react.dev/",
    probes: "client-side nav + SIGNATURE STABILITY (does run 2 hit cache on a real SPA?)",
    run: async (r) => {
      await r.goto("https://react.dev/");
      await r.waitFor("a[href='/learn']"); // let the nav hydrate
      // Deterministic: this href is ambiguous on the real page (multiple matches)
      // — now surfaced truthfully rather than as "no element matched".
      await r.click("a[href='/learn']");
      // ai() rescues the ambiguity AND is the signature-stability probe: run 1
      // should LLM_RESOLVE, run 2 should be CACHED if the page signature is stable.
      await r.clickAI("the 'Learn' link in the top navigation bar");
      await r.waitFor("article h1, main h1");
      await r.extract({ heading: "article h1, main h1" }, "learn page heading");
    },
  },
  {
    id: 19,
    group: "spa",
    name: "vuejs.org",
    url: "https://vuejs.org/",
    probes: "SPA nav then read",
    run: async (r) => {
      await r.goto("https://vuejs.org/");
      // Real href is /guide/introduction (no .html) — hardcoded selectors rot.
      await r.waitFor("a[href='/guide/introduction']");
      await r.click("a[href='/guide/introduction']");
      await r.waitFor("main h1, .content h1, h1");
      await r.extract({ heading: "main h1, h1" }, "guide heading");
    },
  },
  {
    id: 20,
    group: "spa",
    name: "todomvc.react",
    // NOTE: the commonly-cited /examples/react/ now 404s; the live build is at
    // /examples/react/dist/. Recording the rot, testing the working one.
    url: "https://todomvc.com/examples/react/dist/",
    probes: "add a todo, complete it, observe the list mutate",
    run: async (r) => {
      await r.goto("https://todomvc.com/examples/react/dist/");
      await r.type(".new-todo", "validate the sdk", { pressEnter: true });
      await r.waitFor(".todo-list li");
      await r.extract({ todo: ".todo-list li label" }, "added todo");
      await r.click(".todo-list li .toggle");
      await r.extract({ remaining: ".todo-count" }, "remaining count");
    },
  },
  {
    id: 21,
    group: "spa",
    name: "angular.dev",
    url: "https://angular.dev/",
    probes: "navigate a lazy route, wait through the transition",
    run: async (r) => {
      await r.goto("https://angular.dev/");
      await r.click("a[href='/tutorials']");
      await r.waitFor("main h1, docs-viewer h1, h1");
      await r.extract({ heading: "h1" }, "tutorials heading");
    },
  },

  // ===== CACHE + SELF-HEAL STRESS (money story on real DOMs) ================
  {
    id: 22,
    group: "cache-stress",
    name: "hackernews",
    url: "https://news.ycombinator.com/",
    probes: "stable structure, changing content — cleanest pay-once proof",
    run: async (r) => {
      await r.goto("https://news.ycombinator.com/");
      await r.extract({ story: ".titleline > a", rank: ".rank" }, "top story");
      await r.extractAI("the title of the top story"); // cache test (skipped w/o key)
      await r.observe();
    },
  },
  {
    id: 23,
    group: "cache-stress",
    name: "wikipedia.portal",
    url: "https://www.wikipedia.org/",
    probes: "huge stable page; signature hashing must not choke or over-hash",
    run: async (r) => {
      await r.goto("https://www.wikipedia.org/");
      await r.observe();
      await r.extract({ tagline: ".central-textlogo__image, .localized-slogan" }, "tagline");
      await r.clickAI("the English language link"); // cache test (skipped w/o key)
    },
  },
  {
    id: 24,
    group: "cache-stress",
    name: "github.playwright",
    url: "https://github.com/microsoft/playwright",
    probes: "stable chrome + dynamic file list (partial-dynamic)",
    run: async (r) => {
      await r.goto("https://github.com/microsoft/playwright");
      await r.extract({ repo: "strong[itemprop='name'] a, h1 a" }, "repo name");
      await r.observe();
      await r.clickAI("the Issues tab"); // cache test (skipped w/o key)
    },
  },
  {
    id: 25,
    group: "cache-stress",
    name: "amazon",
    url: "https://www.amazon.com/",
    probes: "BOSS FIGHT — consent, late-mount, layout shift, A/B DOM, rotting selectors",
    run: async (r) => {
      await r.goto("https://www.amazon.com/");
      await r.clickAI("dismiss any popup or accept cookies"); // skipped w/o key
      await r.observe();
      await r.extractAI("the main navigation or a product title"); // skipped w/o key
      await r.extract({ logo: "#nav-logo-sprites, #nav-logo" }, "nav logo present");
    },
  },
];


import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    langchain: "src/adapters/langchain.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  // Avoid esbuild's __name (keepNames) helper leaking into functions we serialize
  // into the browser via page.evaluate. (collectInteractive also shims it, but
  // keeping the dist clean is good hygiene.)
  keepNames: false,
  // Playwright and optional peer deps are never bundled.
  external: ["playwright", "@langchain/core", "zod"],
});

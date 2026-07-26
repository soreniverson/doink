import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright launches real browsers; give tests room and run files serially
    // so the fixture server port and the shared browser don't collide.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});

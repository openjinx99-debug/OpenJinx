import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    pool: "forks",
    include: ["src/__system__/**/*.system.test.ts"],
  },
});

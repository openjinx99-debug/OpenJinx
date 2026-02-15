import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 45_000,
    pool: "forks",
    include: ["src/__integration__/**/*.integration.test.ts"],
  },
});

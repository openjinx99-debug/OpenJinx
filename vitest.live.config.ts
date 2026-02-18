import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 900_000,
    pool: "forks",
    include: ["src/**/*.live.test.ts"],
  },
});

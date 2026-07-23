import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "./vitest.base.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["tests/integration/**/*.test.ts"],
      // A Neo4j container must start before tests run.
      hookTimeout: 180_000,
      testTimeout: 30_000,
    },
  }),
);

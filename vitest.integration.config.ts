import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.base.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/integration/**/*.test.ts"],
      // A Neo4j container must start before tests run.
      hookTimeout: 180_000,
      testTimeout: 30_000,
    },
  }),
);

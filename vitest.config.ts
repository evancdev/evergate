import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/routers/**",
        "src/middleware/**",
        "src/env.ts",
        "src/logger.ts",
        "src/types/**",
        "src/services/index.ts",
        "src/services/neo4j.ts",
        "src/tools/index.ts",
        "src/tools/hermes.ts",
        "src/tools/neo4j.ts",
      ],
    },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Shared vitest config */
export default defineConfig({
  resolve: {
    alias: {
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

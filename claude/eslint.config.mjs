import js from "@eslint/js";
import globals from "globals";

// Standalone lint config for the plugin — plain JS, no type-aware rules yet.
export default [
  { ignores: ["node_modules", "dist"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

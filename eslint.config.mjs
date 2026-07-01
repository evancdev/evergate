import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["node_modules", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Config files live outside tsconfig's include; let them use the default project.
        projectService: {
          allowDefaultProject: ["*.config.mjs", "*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Prettier owns formatting; turn off any stylistic rules that would conflict.
  prettier,
);

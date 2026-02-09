import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      curly: ["error", "multi-line"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "build/**",
      ".stryker-tmp/**",
      "coverage/**",
      "reports/**",
    ],
  },
);

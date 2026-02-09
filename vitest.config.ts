import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test-fixtures/**",
        "src/index.ts",
        "src/install.ts",
        "src/parsers/types.ts",
        "src/search/types.ts",
        "src/parsers/registry.ts",
      ],
      reporter: ["text", "lcov", "json"],
      thresholds: {
        // Global thresholds — v8 counts optional chaining/nullish coalescing
        // as branches, so 75% is appropriate for parser-heavy code
        branches: 75,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});

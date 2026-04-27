// Root vitest config — aggregates all packages.
// Each package also has its own config for isolated `pnpm --filter test`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    passWithNoTests: true,
    coverage: {
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.d.ts", "packages/*/src/index.ts"],
    },
  },
});

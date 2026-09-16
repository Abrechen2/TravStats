import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "json-summary"],
      // Without `include`, v8 coverage only counts files some test imported, so
      // a module with no test at all is missing from the denominator and the
      // figure flatters. Measured 2026-09-16: 554 files reported of 647 — the
      // 93 absent ones were exactly the untested ones (forgejo#62).
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "src/__tests__/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "**/*.d.ts",
        "**/*.config.*",
        "src/i18n/resources/**",
      ],
      // No fixed thresholds: the floor is scripts/coverage-baseline.json, checked
      // by scripts/check-coverage.mjs, which only ever tightens.
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

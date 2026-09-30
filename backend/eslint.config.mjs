import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import {
  timePlugin,
  timeRulesEverywhere,
  timeRulesStatusFiles,
} from "../scripts/eslint/timeRules.mjs";

/**
 * Files that decide a day or a status ("past or planned", "today", counting
 * windows). They must not read the clock themselves (ADR 0002, D6): `now` is a
 * parameter or comes from shared/time's clock, so a test can pin it across
 * midnight.
 */
const STATUS_FILES = [
  "src/shared/statusDerivation.ts",
  "src/shared/placeCounting.ts",
  "src/shared/lodgingLifecycle.ts",
  "src/shared/lodgingCounting.ts",
  "src/shared/cruiseCounting.ts",
  "src/shared/railCounting.ts",
  "src/shared/flightCounting.ts",
  "src/shared/flightChronology.ts",
  "src/services/statusSweep.ts",
  "src/jobs/statusSweepScheduler.ts",
];

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        NodeJS: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript strict rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off", // Use TS version instead

      // General quality rules
      "no-console": "off", // Logger is preferred but console is used in bootstrap
      "no-undef": "off", // TypeScript handles this
      "no-redeclare": "off", // TypeScript handles this

      // ESLint 9 recommended rules disabled for pre-existing codebase
      "preserve-caught-error": "off", // ~50 sites need cause chaining — defer to a dedicated cleanup pass
      "no-useless-assignment": "off", // Several pre-existing cases — defer cleanup
    },
  },
  {
    // The time model's host-zone rules (ADR 0002, D6; scripts/eslint/timeRules.mjs),
    // as errors. shared/time is the one module allowed to talk to zones. Tests
    // are ignored below for every rule; the odd-zone CI runs catch a test whose
    // verdict depends on the host. The backend's suppression list reached zero
    // in phase 4 and was deleted: a new offender fails outright.
    files: ["src/**/*.ts"],
    // `__tests__/` helpers (fixtures, CLI probes) are test code like the
    // `*.test.ts` files ignored below — one of them reads the host's zone ON
    // PURPOSE, to prove a result does not depend on it.
    ignores: ["src/shared/time/**", "src/**/__tests__/**"],
    plugins: { time: timePlugin },
    rules: timeRulesEverywhere,
  },
  {
    files: STATUS_FILES,
    plugins: { time: timePlugin },
    rules: timeRulesStatusFiles,
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "**/*.test.ts",
      "**/*.d.ts",
      "src/__mocks__/**",
      // The Prisma 7 client is generated TypeScript, not code we write. It is
      // also gitignored, so linting it would make `npm run lint` depend on
      // whether `prisma generate` has been run yet.
      "src/generated/**",
    ],
  },
];

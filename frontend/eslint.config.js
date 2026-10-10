import { createRequire } from "node:module";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import {
  timePlugin,
  timeRulesEverywhere,
  timeRulesStatusFiles,
} from "../scripts/eslint/timeRules.mjs";

const reactVersion = createRequire(import.meta.url)("react/package.json").version;

const reactRecommended = pluginReact.configs.flat?.recommended ?? pluginReact.configs.recommended;

const unusedVarsRule = [
  "error",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
    destructuredArrayIgnorePattern: "^_",
  },
];

/**
 * Files that decide a day or a status ("past or planned", "today", counting
 * windows). They must not read the clock themselves (ADR 0002, D6): `now` is a
 * parameter or comes from shared/time, so a test can pin it across midnight.
 */
const STATUS_FILES = [
  "src/shared/statusDerivation.ts",
  "src/shared/placeCounting.ts",
  "src/shared/lodgingLifecycle.ts",
  "src/shared/lodgingCounting.ts",
  "src/shared/cruiseCounting.ts",
  "src/shared/railCounting.ts",
  "src/shared/flightCounting.ts",
  "src/lib/journalDefaultDate.ts",
  "src/lib/stats/periodScope.ts",
  "src/lib/stats/comparisonWindow.ts",
];

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...(js.configs.recommended.languageOptions?.globals || {}),
        ...globals.browser,
      },
    },
  },
  ...tseslint.configs.recommended,
  ...(Array.isArray(reactRecommended) ? reactRecommended : [reactRecommended]),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      // Not "detect": eslint-plugin-react 7.37 detects through
      // context.getFilename(), which ESLint 10 removed — every react/* rule
      // then crashes on load. Reading the installed version here is the same
      // answer without the removed API.
      react: { version: reactVersion },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps clashes with the "load once on mount" pattern used
      // in many places (loaders, refresh callbacks). rules-of-hooks (the
      // real bug detector) stays on as an error. Revisit if we migrate
      // loaders to react-query or SWR.
      "react-hooks/exhaustive-deps": "off",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
      "no-unused-vars": "off",
      // The browser's own confirm box speaks the browser's language and says "no"
      // silently where dialogs are suppressed; 19 of them were replaced by
      // hooks/useConfirmDialog on 2026-09-26 (browser acceptance). Keep it so.
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use useConfirmDialog (hooks/useConfirmDialog)." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "confirm",
          message: "Use useConfirmDialog (hooks/useConfirmDialog).",
        },
      ],
    },
  },
  {
    // The time model's host-zone rules (ADR 0002, D6; scripts/eslint/timeRules.mjs).
    // shared/time is the one module allowed to talk to zones. Tests are left
    // out: they build fixtures in whatever zone they like, and the odd-zone CI
    // runs (TZ=Pacific/Kiritimati, America/St_Johns) are what catch a test
    // whose verdict depends on the host. The web tree has no offenders left
    // (phase 4 drove the 159 frozen ones to zero and deleted
    // eslint-suppressions.json): a new one fails outright.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/shared/time/**", "src/**/__tests__/**", "src/**/*.{test,spec}.{ts,tsx}"],
    plugins: { time: timePlugin },
    rules: timeRulesEverywhere,
  },
  {
    files: STATUS_FILES,
    plugins: { time: timePlugin },
    rules: timeRulesStatusFiles,
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Build scripts run in Node, not in a browser: they read design/tokens.json
    // and write into src/theme. Without this they are linted against the
    // browser globals and every `process` and `Buffer` reads as undefined.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];

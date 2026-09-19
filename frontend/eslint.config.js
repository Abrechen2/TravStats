import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

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
      react: { version: "detect" },
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
    },
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

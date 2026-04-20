import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

const reactRecommended = pluginReact.configs.flat?.recommended ?? pluginReact.configs.recommended;

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
      ...pluginReactHooks.configs.recommended.rules,
      // exhaustive-deps is an opinion that clashes with our "load once on
      // mount" pattern in a dozen places. rules-of-hooks (the real bug
      // detector) stays on as an error. Revisit if we migrate loaders to
      // react-query or SWR.
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";

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
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

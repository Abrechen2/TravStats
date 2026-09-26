// Types for timeRules.mjs, so the frontend's RuleTester suite can import it
// under `strict` without a TS7016.
import type { ESLint, Linter } from "eslint";

export declare const timePlugin: ESLint.Plugin & {
  rules: Record<
    "no-host-local-date" | "no-zoneless-format" | "no-zone-library" | "no-ambient-now",
    import("eslint").Rule.RuleModule
  >;
};
export declare const timeRulesEverywhere: Linter.RulesRecord;
export declare const timeRulesStatusFiles: Linter.RulesRecord;

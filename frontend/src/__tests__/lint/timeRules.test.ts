/**
 * The time model's lint rules (scripts/eslint/timeRules.mjs, ADR 0002 D6) and
 * the ratchet they are frozen with.
 *
 * Two halves. The RuleTester half pins what each rule reports and what it
 * lets through — including the near misses a syntactic rule is prone to (a
 * number's `toLocaleString`, a UTC getter). The CLI half runs the real
 * `eslint` binary against a throwaway file with its own suppressions file and
 * proves both edges of the ratchet: a NEW offender fails, and a FIXED one
 * leaves a stale suppression that fails too.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";
import { timePlugin } from "../../../../scripts/eslint/timeRules.mjs";

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

const rules = timePlugin.rules;

describe("time/no-host-local-date", () => {
  tester.run("no-host-local-date", rules["no-host-local-date"], {
    valid: [
      "d.getUTCFullYear(); d.getUTCHours(); d.getTime(); d.setUTCDate(1);",
      "new Date(Date.UTC(2027, 0, 1));",
      'new Date("2027-01-01T00:00:00Z");',
      "new Date(ms);",
      // A reference, not a call, is not a reading.
      "const f = d.getHours;",
      // A plain function named like a setter is React state, not a Date.
      "setDate(value);",
    ],
    invalid: [
      { code: "d.getFullYear();", errors: [{ messageId: "hostGetter" }] },
      { code: "d.getMonth(); d.getDate();", errors: 2 },
      { code: "x.when.getHours();", errors: [{ messageId: "hostGetter" }] },
      { code: "d.getTimezoneOffset();", errors: [{ messageId: "hostGetter" }] },
      { code: "d.setHours(0, 0, 0, 0);", errors: [{ messageId: "hostGetter" }] },
      { code: 'd["getDay"]();', errors: [{ messageId: "hostGetter" }] },
      { code: "new Date(2027, 0, 1);", errors: [{ messageId: "hostConstructor" }] },
      { code: "new Date(y, m);", errors: [{ messageId: "hostConstructor" }] },
    ],
  });
});

describe("time/no-zoneless-format", () => {
  tester.run("no-zoneless-format", rules["no-zoneless-format"], {
    valid: [
      'd.toLocaleDateString("de-DE", { timeZone: "UTC" });',
      'd.toLocaleTimeString(locale, { hour: "2-digit", timeZone: zone });',
      'const opts = { timeZone: "Europe/Berlin" }; d.toLocaleDateString("de", opts);',
      'new Intl.DateTimeFormat("en", { timeZone: zone, month: "long" });',
      'Intl.DateTimeFormat("en", { "timeZone": "UTC" });',
      // Numbers: the distance formatters are not dates.
      'distanceKm.toLocaleString("de-DE");',
      "Math.round(total).toLocaleString(locale);",
      "count.toLocaleString();",
      'new Intl.NumberFormat("de").format(3);',
    ],
    invalid: [
      { code: "d.toLocaleDateString();", errors: [{ messageId: "localeString" }] },
      {
        code: 'd.toLocaleTimeString("de-DE", { hour: "2-digit" });',
        errors: [{ messageId: "localeString" }],
      },
      {
        code: 'let opts = { timeZone: "UTC" }; d.toLocaleDateString("de", opts);',
        errors: [{ messageId: "localeString" }],
      },
      {
        code: 'd.toLocaleDateString("de", someOptions);',
        errors: [{ messageId: "localeString" }],
      },
      {
        code: 'new Date(startedAt).toLocaleString("de-DE", opts);',
        errors: [{ messageId: "localeString" }],
      },
      { code: "time.toLocaleString(locale);", errors: [{ messageId: "localeString" }] },
      { code: "trip.departureTime.toLocaleString();", errors: [{ messageId: "localeString" }] },
      { code: "row.createdAt.toLocaleString();", errors: [{ messageId: "localeString" }] },
      {
        code: 'new Intl.DateTimeFormat("de", { month: "long" });',
        errors: [{ messageId: "intlFormat" }],
      },
      {
        code: "Intl.DateTimeFormat().resolvedOptions().timeZone;",
        errors: [{ messageId: "intlFormat" }],
      },
    ],
  });
});

describe("time/no-zone-library", () => {
  tester.run("no-zone-library", rules["no-zone-library"], {
    valid: [
      'import { differenceInCalendarDays } from "date-fns";',
      'import { isValid } from "date-fns-tz";',
      'import { format } from "./myFormat";',
    ],
    invalid: [
      {
        code: 'import { format } from "date-fns";',
        errors: [{ messageId: "restricted" }],
      },
      {
        code: 'import { fromZonedTime, toZonedTime } from "date-fns-tz";',
        errors: 2,
      },
      {
        code: 'import { formatInTimeZone as fmt } from "date-fns-tz";',
        errors: [{ messageId: "restricted" }],
      },
      {
        code: 'import * as tz from "date-fns-tz";',
        errors: [{ messageId: "namespace" }],
      },
    ],
  });
});

describe("time/no-ambient-now", () => {
  tester.run("no-ambient-now", rules["no-ambient-now"], {
    valid: ["deriveStatus(flight, now);", "new Date(now);", "clock.now();", "performance.now();"],
    invalid: [
      { code: "const t = Date.now();", errors: [{ messageId: "ambientNow" }] },
      { code: "const today = new Date();", errors: [{ messageId: "ambientNow" }] },
    ],
  });
});

// ── The ratchet, through the real CLI ─────────────────────────────────────

const FRONTEND = resolve(__dirname, "../../..");
const ESLINT_BIN = join(FRONTEND, "node_modules", "eslint", "bin", "eslint.js");
const workDir = mkdtempSync(join(FRONTEND, "node_modules", ".time-ratchet-"));

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const RULES_URL = pathToFileURL(resolve(FRONTEND, "../scripts/eslint/timeRules.mjs")).href;

writeFileSync(
  join(workDir, "eslint.config.mjs"),
  `import tseslint from "typescript-eslint";
import { timePlugin, timeRulesEverywhere } from ${JSON.stringify(RULES_URL)};
export default [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser },
  plugins: { time: timePlugin }, rules: timeRulesEverywhere }];
`
);

function lint(source: string, suppressedCount: number): { status: number | null; out: string } {
  writeFileSync(join(workDir, "probe.ts"), source);
  writeFileSync(
    join(workDir, "eslint-suppressions.json"),
    JSON.stringify({ "probe.ts": { "time/no-host-local-date": { count: suppressedCount } } })
  );
  const run = spawnSync(process.execPath, [ESLINT_BIN, "--no-warn-ignored", "probe.ts"], {
    cwd: workDir,
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

const ONE = "export const h = (d: Date) => d.getHours();\n";
const TWO = "export const h = (d: Date) => d.getHours() + d.getMinutes();\n";
const NONE = "export const h = (d: Date) => d.getUTCHours();\n";

describe("the suppression ratchet", () => {
  it("passes when the frozen count matches the offenders (control)", () => {
    expect(lint(ONE, 1).status).toBe(0);
  });

  it("fails on a new offender beyond the frozen count", () => {
    const result = lint(TWO, 1);
    expect(result.status).toBe(1);
    expect(result.out).toContain("time/no-host-local-date");
  });

  it("fails on a stale suppression once an offender is fixed", () => {
    const result = lint(NONE, 1);
    expect(result.status).not.toBe(0);
    expect(result.out).toMatch(/suppressions left that do not occur anymore/);
  });
}, 60_000);

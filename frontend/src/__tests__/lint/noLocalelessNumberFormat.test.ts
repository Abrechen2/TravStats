import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A number formatted without a locale follows the BROWSER, not the language
 * the app speaks: a German page in an en-US browser printed "14,808 km"
 * (forgejo#88 acceptance, 2026-10-10). Every such call goes through
 * `formatNumber` / `appLocale` / `localeForLanguage` in lib/units.ts.
 *
 * Refused here: `x.toLocaleString()`, `x.toLocaleString(undefined, …)`,
 * `x.toLocaleString({ … })`, and `new Intl.NumberFormat()` /
 * `(undefined, …)` / `({ … })`. Dates are covered as well by the first form —
 * `Date#toLocaleString` has the same flaw.
 */
const SRC = resolve(__dirname, "../..");

const OFFENDERS: readonly RegExp[] = [
  /[\w)\]]\.toLocaleString\(\s*(?:\)|undefined\b|\{)/g,
  /new\s+Intl\.NumberFormat\(\s*(?:\)|undefined\b|\{)/g,
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "generated") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function findLocalelessCalls(source: string): string[] {
  return OFFENDERS.flatMap((re) => [...source.matchAll(re)].map((m) => m[0]));
}

describe("no locale-less number formatting", () => {
  it("the scan catches each refused form and lets an explicit locale through", () => {
    expect(findLocalelessCalls("n.toLocaleString()")).toHaveLength(1);
    expect(findLocalelessCalls("x.km.toLocaleString(undefined, { a: 1 })")).toHaveLength(1);
    expect(findLocalelessCalls("f(n).toLocaleString({ maximumFractionDigits: 0 })")).toHaveLength(
      1
    );
    expect(findLocalelessCalls("new Intl.NumberFormat(undefined, {})")).toHaveLength(1);
    expect(findLocalelessCalls("n.toLocaleString(appLocale())")).toHaveLength(0);
    expect(findLocalelessCalls('new Intl.NumberFormat("de-DE")')).toHaveLength(0);
    expect(findLocalelessCalls("// `toLocaleString()` once did this")).toHaveLength(0);
  });

  it("no source file formats a number in the browser's locale", () => {
    const hits = sources(SRC).flatMap((file) =>
      findLocalelessCalls(readFileSync(file, "utf8")).map((m) => `${relative(SRC, file)}: ${m}`)
    );
    expect(hits).toEqual([]);
  });
});

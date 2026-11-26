import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One formatting module (rc.47). Seven files each carried their own
 * `formatDate`, six their own `formatKm`, five `formatDuration`, three
 * `formatDistance`, and the map cards printed `toLocale*String` straight into
 * HTML — so one number could read "3.931 km" on a card and "3931" in a table,
 * and a user on miles saw kilometres on half the screens.
 *
 * Dates, durations, distances and money are written by `lib/format.ts` (the
 * number/currency primitives it re-exports live in `lib/units.ts`). Refused
 * here, outside those two files: a local definition of those helpers and a
 * bare `toLocaleDateString` / `toLocaleTimeString`. Ratchet baseline: zero.
 */
const SRC = resolve(__dirname, "../..");
const HOMES = new Set(["lib/format.ts", "lib/units.ts"]);

const DEFINITION =
  /\b(?:function\s+|(?:const|let)\s+)(formatDate|formatDateTime|formatTime|formatKm|formatKmNumber|formatDuration|formatDistance|formatMoney)\b\s*(?:[(<=:])/g;
const BARE_DATE_LOCALE = /\.toLocale(?:Date|Time)String\(/g;

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

export function findLocalFormatters(source: string): string[] {
  return [...source.matchAll(DEFINITION), ...source.matchAll(BARE_DATE_LOCALE)].map((m) => m[0]);
}

describe("no local formatters", () => {
  it("the scan catches a local copy and a bare toLocaleDateString", () => {
    expect(findLocalFormatters("function formatKm(v: number) {}")).toHaveLength(1);
    expect(findLocalFormatters("const formatDate = (iso: string) => iso;")).toHaveLength(1);
    expect(findLocalFormatters("export const formatDuration: F = x")).toHaveLength(1);
    expect(findLocalFormatters("d.toLocaleDateString(locale, {})")).toHaveLength(1);
    expect(
      findLocalFormatters("import { formatKm } from '../lib/format'; formatKm(3)")
    ).toHaveLength(0);
  });

  it("no file outside lib/format.ts and lib/units.ts defines its own formatter", () => {
    const hits = sources(SRC)
      .filter((file) => !HOMES.has(relative(SRC, file)))
      .flatMap((file) =>
        findLocalFormatters(readFileSync(file, "utf8")).map((m) => `${relative(SRC, file)}: ${m}`)
      );
    expect(hits).toEqual([]);
  });
});

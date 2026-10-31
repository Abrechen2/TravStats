// forgejo#383 (PERF-33): `useSettingsStore()` without a selector subscribes the
// component to the whole store, so it re-renders on every settings write. 16
// components did. Read the fields you use: `useSettingsStore((s) => s.units)`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "generated") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe("settings store subscriptions", () => {
  it("no source file subscribes to the whole settings store", () => {
    const offenders = sources(SRC)
      .filter((p) => /useSettingsStore\(\s*\)/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p));
    expect(offenders).toEqual([]);
  });
});

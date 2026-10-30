import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * forgejo#385 (RULE-37): eight files re-declared the flight counting rule as
 * their own `["flown", "historical"]`. The rule has one home,
 * `shared/flightCounting.ts`; this scan fails when a copy comes back.
 */
const SRC = join(__dirname, "..", "..");
const COPY =
  /new Set\(\s*\[\s*["']flown["']\s*,\s*["']historical["']|=== ["']flown["'] \|\| \w+(\.\w+)* === ["']historical["']|status: \{ in: \[\s*["']flown["']\s*,\s*["']historical["']/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" || name === "generated" ? [] : sources(full);
    }
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

describe("the flight counting rule has one home", () => {
  it("no production file re-declares flown+historical", () => {
    const offenders = sources(SRC)
      .filter((f) => !f.endsWith(join("shared", "flightCounting.ts")))
      .filter((f) => !f.includes(join("src", "scripts")))
      .filter((f) => COPY.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

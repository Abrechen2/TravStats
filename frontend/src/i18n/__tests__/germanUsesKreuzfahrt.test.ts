import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * German copy says "Kreuzfahrt". It says so 155 times — and said "Cruise" in
 * three places, one of which was a button: "Cruise öffnen" on the map card, in
 * a German UI (browser verification, beta.12).
 *
 * This is a RULE, not a copy of the strings: the domain word in German is
 * Kreuzfahrt, and the one exception is a line's NAME. A brand is recognised by
 * the all-caps token in front of it — "AIDA Cruises", "MSC Cruises" — which is
 * the only form a cruise line's name takes in this product.
 *
 * English resources are untouched by this: "Open cruise" is correct there.
 */

const DE = resolve(__dirname, "../resources/de");

/** `Cruise`/`Cruises` NOT preceded by an all-caps brand token. */
const STRAY_CRUISE = /(?<![A-ZÄÖÜ]{2,10}\s)\bCruises?\b/;

function stringsOf(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === "string") {
    out.push([path, value]);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      stringsOf(v, path ? `${path}.${k}` : k, out);
    }
  }
}

describe("warden: German copy names the domain in German", () => {
  const offenders: string[] = [];
  let scanned = 0;
  for (const file of readdirSync(DE)) {
    if (!file.endsWith(".json")) continue;
    const parsed: unknown = JSON.parse(readFileSync(join(DE, file), "utf8"));
    const entries: Array<[string, string]> = [];
    stringsOf(parsed, "", entries);
    scanned += entries.length;
    for (const [path, text] of entries) {
      if (STRAY_CRUISE.test(text)) offenders.push(`${file} ${path} = ${text}`);
    }
  }

  it("reads something — otherwise the scan has drifted and passes silently", () => {
    expect(scanned).toBeGreaterThan(1000);
  });

  it('says "Kreuzfahrt", never a bare "Cruise"', () => {
    expect(offenders, 'use "Kreuzfahrt"; only a line\'s name keeps the English word').toEqual([]);
  });

  it("still allows a cruise line's actual name", () => {
    expect(STRAY_CRUISE.test("z. B. AIDA Cruises")).toBe(false);
    expect(STRAY_CRUISE.test("MSC Cruises")).toBe(false);
    expect(STRAY_CRUISE.test("Cruise öffnen")).toBe(true);
  });
});

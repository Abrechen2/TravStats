import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * German copy says "Kreuzfahrt". It says so 155 times — and said "Cruise" in
 * three places, one of which was a button: "Cruise öffnen" on the map card, in
 * a German UI (browser verification, beta.12).
 *
 * This is a RULE, not a copy of the strings: the domain word in German is
 * Kreuzfahrt, and the one exception is a line's NAME.
 *
 * The match is CASE-INSENSITIVE, and that is the correction this warden needed
 * most. It used to be `/(?<![A-ZÄÖÜ]{2,10}\s)\bCruises?\b/` with no `i` flag,
 * so it only ever saw the one spelling the defect happened to use: measured,
 * `"cruise öffnen"` and `"CRUISE öffnen"` both tested false. A warden a
 * re-casing walks past reports green on the very defect it was written for.
 *
 * Turning the word case-insensitive costs the old brand exception, because an
 * `i` flag applies to the lookbehind too — `[A-ZÄÖÜ]` would then match lower
 * case as well, and every word in front of "Cruise" would excuse it. So the
 * exception is expressed as SHAPE, checked separately and case-sensitively:
 *
 * - an ALL-CAPS token: "AIDA Cruises", "MSC Cruises", "TUI Cruises";
 * - a Title-Case token, but only in front of the PLURAL: "Royal Caribbean
 *   Cruises", "Princess Cruises". "Neue Cruise" therefore stays a finding —
 *   the old any-caps lookbehind caught that one too, and a naive Title-Case
 *   rule would have handed it an exemption.
 *
 * Grounded, not guessed: the only brand-shaped occurrence in the entire German
 * resource tree is `settings.cruisePreferences.defaultLinePlaceholder`,
 * "z. B. AIDA Cruises". The fixtures below add "MSC Cruises".
 *
 * English resources are untouched by this: "Open cruise" is correct there.
 */

const DE = resolve(__dirname, "../resources/de");

/** i18next interpolation. `{{cruises}}` is a VARIABLE NAME, not copy — two
 *  German strings carry it (`cruise.import.savedWithFlights`,
 *  `stats.overview2.experiencesHint`), and a case-insensitive scan reads both
 *  as the word it is hunting. Strip before looking. */
const INTERPOLATION = /\{\{[^}]*\}\}/g;

/** The English domain word in ANY casing — that is the whole point. */
const CRUISE_WORD = /\bcruises?\b/gi;

/** Brand SHAPE, deliberately NOT case-insensitive: the shape is the signal. */
const BRAND_ALLCAPS = /^[A-ZÄÖÜ][A-ZÄÖÜ0-9&.-]{1,9}$/;
const BRAND_TITLECASE = /^[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)*$/;

function isLineName(text: string, index: number, word: string): boolean {
  // A line's name keeps the word capitalised — "AIDA Cruises". Lower case and
  // ALL CAPS are never a brand here, so they stay strays: this line is what
  // stops the `i` flag from handing the exception to the defect.
  if (!/^Cruises?$/.test(word)) return false;
  const previous = text.slice(0, index).trimEnd().split(/\s+/).pop() ?? "";
  if (BRAND_ALLCAPS.test(previous)) return true;
  // A Title-Case token is also just a German word opening a sentence, so it
  // only excuses the PLURAL — the form every line's name takes.
  return word === "Cruises" && BRAND_TITLECASE.test(previous);
}

/** Every occurrence of the English domain word that is not a line's name. */
function strayCruises(text: string): string[] {
  const copy = text.replace(INTERPOLATION, " ");
  const out: string[] = [];
  for (const match of copy.matchAll(CRUISE_WORD)) {
    if (!isLineName(copy, match.index ?? 0, match[0])) out.push(match[0]);
  }
  return out;
}

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
      if (strayCruises(text).length > 0) offenders.push(`${file} ${path} = ${text}`);
    }
  }

  it("reads something — otherwise the scan has drifted and passes silently", () => {
    expect(scanned).toBeGreaterThan(1000);
  });

  it('says "Kreuzfahrt", never a bare "Cruise"', () => {
    expect(offenders, 'use "Kreuzfahrt"; only a line\'s name keeps the English word').toEqual([]);
  });

  it("still allows a cruise line's actual name", () => {
    expect(strayCruises("z. B. AIDA Cruises")).toEqual([]);
    expect(strayCruises("MSC Cruises")).toEqual([]);
    expect(strayCruises("Royal Caribbean Cruises")).toEqual([]);
  });

  it("catches the stray whatever case it is written in", () => {
    // The old pattern saw only the first of these. The other two are the
    // exact defect — a button reading "Cruise" in a German UI — one shift
    // key away, and it reported them clean.
    expect(strayCruises("Cruise öffnen")).toEqual(["Cruise"]);
    expect(strayCruises("cruise öffnen")).toEqual(["cruise"]);
    expect(strayCruises("CRUISE öffnen")).toEqual(["CRUISE"]);
    // A brand-shaped token in front does not rescue a shouted word: a line's
    // name capitalises "Cruises", it does not shout it.
    expect(strayCruises("AIDA CRUISE buchen")).toEqual(["CRUISE"]);
  });

  it("excuses brand shape, not any word that happens to precede", () => {
    // The exemption is a shape test on the preceding token, so an all-caps
    // German word still excuses — that is inherent and was true before. What
    // must NOT happen is a Title-Case German word excusing the singular.
    expect(strayCruises("ACHTUNG Cruise")).toEqual([]);
    expect(strayCruises("Neue Cruise anlegen")).toEqual(["Cruise"]);
    expect(strayCruises("Ab Cruise")).toEqual(["Cruise"]);
  });

  it("reads an interpolation placeholder as a variable, not as copy", () => {
    // `{{cruises}}` names a count. Without this, the case-insensitive scan
    // would report `cruise.import.savedWithFlights` as German copy saying
    // "cruises".
    expect(strayCruises("{{cruises}} Kreuzfahrt(en) + {{flights}} Flüge")).toEqual([]);
  });
});

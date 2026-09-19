import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The required-field asterisk is a COMPONENT, never a character in a
 * translated string.
 *
 * Measured in the browser on the public beta (2.7.0-beta.8), manual flight
 * form: "Von * *", "Nach * *", "Abflugdatum * *". `flights:form.from`,
 * `form.to` and `form.departureDate` still carried a trailing " *" from
 * before `RequiredMark` existed, and the form now appends the component as
 * well — so every required label wore the mark twice.
 *
 * A literal mark is wrong twice over. It doubles up wherever a marker
 * component is used, and it travels with the key: the same
 * `flights:form.from` labels the fold SUMMARY of the core section
 * (FlightCompleteStep's `coreSummary`) and the edit form's route pickers,
 * neither of which is a required field at all. One string cannot be right in
 * both places, which is why the mark belongs to the place, not to the copy.
 *
 * Deliberately a whole-tree rule rather than a list of the five keys that
 * were wrong: the next one would be added by someone who never read this
 * file. `flights:form.requiredLegend` ("* Pflichtfeld") is untouched — it
 * OPENS with the mark because it is the sentence that explains it, and the
 * rule only refuses a trailing one.
 */

const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");

/** A mark hung on the end of a label, e.g. "Abflugdatum *". */
// A star at the end, with or without a space before it and with or without
// trailing whitespace after it — a reviewer noted that `/\s\*$/` would let
// "Flugnummer*" and "Flugnummer * " through, which is the same defect.
const TRAILING_MARK = /\*\s*$/;

function collectOffenders(dir: string, locale: string): string[] {
  const offenders: string[] = [];

  const walk = (node: unknown, trail: string[]): void => {
    if (typeof node === "string") {
      if (TRAILING_MARK.test(node)) offenders.push(`${locale}/${trail.join(".")} = ${node}`);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, [...trail, key]);
      }
    }
  };

  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    walk(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")), [file.replace(/\.json$/, "")]);
  }
  return offenders.sort();
}

describe("no translated string carries a required marker", () => {
  it("reads both locales — otherwise the scan has drifted and passes silently", () => {
    expect(fs.readdirSync(path.join(RESOURCES_ROOT, "de")).length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(RESOURCES_ROOT, "en")).length).toBeGreaterThan(0);
  });

  it("leaves the asterisk to <RequiredMark />, in DE and EN alike", () => {
    const offenders = [
      ...collectOffenders(path.join(RESOURCES_ROOT, "de"), "de"),
      ...collectOffenders(path.join(RESOURCES_ROOT, "en"), "en"),
    ];
    expect(offenders, "drop the trailing ' *' and mark the field at its use site").toEqual([]);
  });
});

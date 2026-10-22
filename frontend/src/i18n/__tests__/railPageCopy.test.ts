import { describe, expect, it } from "vitest";

import deRail from "../resources/de/rail.json";
import enRail from "../resources/en/rail.json";
import { RAIL_ACCEPTED_EMAIL_EXTENSIONS } from "../../components/import/adapters/railAdapter";

/**
 * Acceptance D7 (2026-09-26): the rail page still said "Der Import von
 * Buchungen folgt" while the import had shipped behind its own button. The
 * note now points at that button, by the button's own label, so the two
 * cannot drift apart silently.
 */
describe("the rail page's import note", () => {
  it.each([
    ["de", deRail],
    ["en", enRail],
  ])("points at the import in %s instead of promising it", (_locale, rail) => {
    expect(rail.importNote).toContain(rail.add);
    expect(rail.importNote).not.toMatch(/folgt|comes next/);
  });

  // Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22); the page must not say otherwise.
  it.each([
    ["de", deRail],
    ["en", enRail],
  ])("no longer calls rail beta in %s", (_locale, rail) => {
    expect(rail.importNote).not.toMatch(/beta/i);
    expect("betaNote" in rail).toBe(false);
  });
});

/**
 * forgejo#162: the note promised that "Fahrt hinzufügen" reads calendar files,
 * while the dialog listed .eml/.msg/.txt/.pdf and its file picker refused .ics.
 * Every format the note names must be one the dialog's picker accepts.
 */
const NAMED_FORMATS: ReadonlyArray<[RegExp, string]> = [
  [/PDF/i, ".pdf"],
  [/\.eml/i, ".eml"],
  [/\.msg/i, ".msg"],
  [/Kalender|calendar|\.ics/i, ".ics"],
];

describe("the rail page's import note names only what the add dialog accepts", () => {
  const accepted = [...RAIL_ACCEPTED_EMAIL_EXTENSIONS, ".pdf"];
  it.each([
    ["de", deRail],
    ["en", enRail],
  ])("in %s", (_locale, rail) => {
    const promised = NAMED_FORMATS.filter(([re]) => re.test(rail.importNote)).map(([, ext]) => ext);
    expect(promised.filter((ext) => !accepted.includes(ext))).toEqual([]);
  });
});

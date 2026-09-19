import { describe, it, expect } from "vitest";

import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";
import dePlaces from "../resources/de/places.json";
import enPlaces from "../resources/en/places.json";

/**
 * Auditor 3, 2026-09-19: `/flights` reported "174 angezeigt" above a table
 * showing rows 1–50, `/lodging` "33 angezeigt", `/places` "95 von 95". The
 * number is right and the verb is wrong — it counts what the FILTER matched,
 * while "angezeigt" claims it is what is on the screen, and the pagination
 * footer two lines below says otherwise.
 *
 * Asserted as the absence of the display vocabulary rather than as the new
 * sentence: the rule is that this label must not claim to count what is
 * visible, not that it must use one particular wording.
 */
const LABELS: readonly [string, string][] = [
  ["de common:filters.matching", deCommon.filters.matching],
  ["en common:filters.matching", enCommon.filters.matching],
  ["de places:list.resultCount", dePlaces.list.resultCount],
  ["en places:list.resultCount", enPlaces.list.resultCount],
];

describe("the filter result counter", () => {
  it.each(LABELS)("%s does not claim to count what is on screen", (_name, label) => {
    // Placeholders are stripped first: `{{shown}}` is a variable name, not a
    // word the reader ever sees.
    const prose = label.replace(/\{\{[^}]*\}\}/g, " ").toLowerCase();
    expect(prose).not.toMatch(/angezeigt|\bshown\b|\bdisplayed\b/);
  });

  it.each(LABELS)("%s still carries its count placeholder", (_name, label) => {
    expect(label).toMatch(/\{\{(count|shown)\}\}/);
  });

  it("no longer offers the old key, so a stale call site is visible at once", () => {
    expect("showing" in deCommon.filters).toBe(false);
    expect("showing" in enCommon.filters).toBe(false);
  });
});

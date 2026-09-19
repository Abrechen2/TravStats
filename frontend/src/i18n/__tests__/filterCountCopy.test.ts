import { describe, it, expect } from "vitest";
import { createInstance } from "i18next";

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
  ["de common:filters.matching_one", deCommon.filters.matching_one],
  ["de common:filters.matching_other", deCommon.filters.matching_other],
  ["en common:filters.matching_one", enCommon.filters.matching_one],
  ["en common:filters.matching_other", enCommon.filters.matching_other],
  ["de places:list.resultCount_one", dePlaces.list.resultCount_one],
  ["de places:list.resultCount_other", dePlaces.list.resultCount_other],
  ["en places:list.resultCount_one", enPlaces.list.resultCount_one],
  ["en places:list.resultCount_other", enPlaces.list.resultCount_other],
];

/** The singular form names ONE, so it need not carry the placeholder. */
const PLURAL_FORMS: readonly [string, string][] = [
  ["de common:filters.matching_other", deCommon.filters.matching_other],
  ["en common:filters.matching_other", enCommon.filters.matching_other],
  ["de places:list.resultCount_other", dePlaces.list.resultCount_other],
  ["en places:list.resultCount_other", enPlaces.list.resultCount_other],
];

describe("the filter result counter", () => {
  it.each(LABELS)("%s does not claim to count what is on screen", (_name, label) => {
    // Placeholders are stripped first: `{{shown}}` is a variable name, not a
    // word the reader ever sees.
    const prose = label.replace(/\{\{[^}]*\}\}/g, " ").toLowerCase();
    expect(prose).not.toMatch(/angezeigt|\bshown\b|\bdisplayed\b/);
  });

  it.each(PLURAL_FORMS)("%s still carries its count placeholder", (_name, label) => {
    expect(label).toMatch(/\{\{count\}\}/);
  });

  /**
   * Review, 2026-09-19: "1 treffen zu". i18next picks a plural form off
   * `count` and off nothing else, so a label with a bespoke variable name
   * ("shown") could not have one at all -- which is why `places:list.resultCount`
   * was reworded onto `count` rather than given a second form beside `shown`.
   */
  it.each([
    ["de common:filters", deCommon.filters],
    ["en common:filters", enCommon.filters],
  ])("%s carries both plural forms of the match counter", (_name, group) => {
    expect(group).toHaveProperty("matching_one");
    expect(group).toHaveProperty("matching_other");
    expect(group).not.toHaveProperty("matching");
  });

  it.each([
    ["de places:list", dePlaces.list],
    ["en places:list", enPlaces.list],
  ])("%s carries both plural forms of the result counter", (_name, group) => {
    expect(group).toHaveProperty("resultCount_one");
    expect(group).toHaveProperty("resultCount_other");
    expect(group).not.toHaveProperty("resultCount");
  });

  it("no longer offers the old key, so a stale call site is visible at once", () => {
    expect("showing" in deCommon.filters).toBe(false);
    expect("showing" in enCommon.filters).toBe(false);
  });
});

/**
 * The plural forms through i18next itself, not through their JSON.
 *
 * Asserting the two strings exist says nothing about what a reader sees:
 * i18next picks a form off `count` and off nothing else, and the rule for
 * which suffix it looks for is the library's, not ours. One real instance,
 * resolving real bundles, is the only thing that answers "what does this
 * print for one row".
 */
describe("what the counter prints for a single match", () => {
  const instance = createInstance();
  void instance.init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { common: deCommon, places: dePlaces },
      en: { common: enCommon, places: enPlaces },
    },
  });

  const say = (lng: "de" | "en", key: string, count: number, extra = {}): string =>
    instance.getFixedT(lng)(key, { count, ...extra });

  it.each([
    ["de", 1, "1 trifft zu"],
    ["de", 174, "174 treffen zu"],
    ["en", 1, "1 matches"],
    ["en", 174, "174 match"],
  ] as const)("%s, %s row(s): %s", (lng, count, expected) => {
    expect(say(lng, "common:filters.matching", count)).toBe(expected);
  });

  it.each([
    ["de", 1, "1 von 95 trifft zu"],
    ["de", 95, "95 von 95 treffen zu"],
    ["en", 1, "1 of 95 matches"],
    ["en", 95, "95 of 95 match"],
  ] as const)("places — %s, %s row(s): %s", (lng, count, expected) => {
    expect(say(lng, "places:list.resultCount", count, { total: 95 })).toBe(expected);
  });
});

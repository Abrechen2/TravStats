import { describe, expect, it } from "vitest";
import { findAreaPage } from "../area/areaModel";
import { sectionsOf } from "../surface";
import type { BetaFeatureKey } from "../../../config/betaFeatures";

/**
 * The calendar subscription card (forgejo#310) sits on the "Reisen" page. It
 * left beta on 2026-11-01 (forgejo#390): it is there whether or not the
 * instance's beta switch is on, so a stale gate cannot hide it again.
 */
const trips = findAreaPage("reisen")!;
const shown = (betaOpen: boolean): string[] =>
  sectionsOf(trips, {
    level: "expert",
    isGateOpen: (_key: BetaFeatureKey) => betaOpen,
    isAdmin: false,
    deepLinked: null,
  }).shown;

describe("calendar feed card", () => {
  it("is on the trips page with the beta switch off (released, forgejo#390)", () => {
    expect(shown(false)).toContain("calendarFeed");
  });

  it("is on the trips page with the beta switch on", () => {
    expect(shown(true)).toContain("calendarFeed");
  });
});

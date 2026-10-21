import { describe, expect, it } from "vitest";
import { findPage } from "../settingsModel";
import { sectionsOf } from "../surface";
import type { BetaFeatureKey } from "../../../config/betaFeatures";

/**
 * The calendar subscription card (forgejo#310) sits on the "Reisen" page
 * behind its own beta key, `calendarFeed`: absent while the instance's beta
 * switch is off, there when it is on. Since forgejo#321 it is a section of
 * its own, so the gate lives in the page table rather than inside a section.
 */
const trips = findPage("trips")!;
const shown = (open: boolean, deepLinked: string | null = null): string[] =>
  sectionsOf(trips, {
    level: "expert",
    isGateOpen: (key: BetaFeatureKey) => open && key === "calendarFeed",
    isAdmin: false,
    deepLinked,
  }).shown;

describe("calendar feed card gate", () => {
  it("is absent from the trips page while the beta switch is off", () => {
    expect(shown(false)).toContain("shareLinks");
    expect(shown(false)).not.toContain("calendarFeed");
  });

  it("is on the trips page when the beta switch is on", () => {
    expect(shown(true)).toContain("calendarFeed");
  });

  // Only device pairing lets a link lift its gate (CLAUDE.md, beta gating);
  // un-gating anything else is the owner's call.
  it("stays out when a link names it while the switch is off", () => {
    expect(shown(false, "calendarFeed")).not.toContain("calendarFeed");
  });
});

import { describe, it, expect } from "vitest";

import deTrips from "../resources/de/trips.json";
import enTrips from "../resources/en/trips.json";
import { SETTINGS_SECTIONS } from "../../pages/Settings/settingsModel";

/**
 * forgejo#318: the detection is named for what it does, not for markets
 * (owner, 2026-10-20: „muss nicht so genannt werden"). It finds markets,
 * malls, parks, zoos and museums as whole areas.
 */
describe("detecting places automatically — the wording", () => {
  it("has no switch of its own any more: markets and venues are recognised with every scan", () => {
    expect(deTrips.dawarichStays.areas).not.toHaveProperty("title");
    expect(enTrips.dawarichStays.markets).not.toHaveProperty("enable");
    expect(deTrips.dawarichStays.venues).not.toHaveProperty("enable");
  });

  it("says where positions go in both languages", () => {
    expect(deTrips.dawarichStays.areas.description).toMatch(/OpenStreetMap/);
    expect(enTrips.dawarichStays.areas.description).toMatch(/OpenStreetMap/);
  });
});

/** The market and venue switches are gone; the stay scan claims no expert rows. */
describe("the stay scan section", () => {
  it("has no expert rows left", () => {
    const def = SETTINGS_SECTIONS.find((x) => x.id === "stayScan")!;
    expect(def.expertRows).toBeFalsy();
  });
});

import { describe, expect, it } from "vitest";
import {
  draftFromShareLinkFacts,
  hasShareLinkFacts,
  isRailShareLinkPrefill,
} from "../railShareLinkModel";

const NONE = {
  departureStationName: null,
  arrivalStationName: null,
  departureLocal: null,
  travelClass: null,
};

describe("railShareLinkModel (forgejo#204)", () => {
  it("starts the manual form from the link's own facts, stations without a position", () => {
    const draft = draftFromShareLinkFacts({
      departureStationName: "München Hbf",
      arrivalStationName: "Berlin Hbf",
      departureLocal: "2026-10-15T08:00",
      travelClass: "second",
    });
    expect(draft.departure).toEqual({
      name: "München Hbf",
      lat: null,
      lon: null,
      country: null,
      code: null,
      stationId: null,
    });
    expect(draft.arrival.name).toBe("Berlin Hbf");
    expect(draft).toMatchObject({ departureLocal: "2026-10-15T08:00", travelClass: "second" });
    // Nothing the link did not say is filled in.
    expect(draft).toMatchObject({ operator: "", bookingReference: "", price: "" });
  });

  it("knows when a link carried nothing, and recognises only its own prefill", () => {
    expect(hasShareLinkFacts(NONE)).toBe(false);
    expect(hasShareLinkFacts({ ...NONE, travelClass: "first" })).toBe(true);
    expect(
      isRailShareLinkPrefill({ kind: "railShareLink", draft: draftFromShareLinkFacts(NONE) })
    ).toBe(true);
    expect(isRailShareLinkPrefill({ kind: "other", draft: {} })).toBe(false);
    expect(isRailShareLinkPrefill(undefined)).toBe(false);
  });
});

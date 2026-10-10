import { describe, expect, it } from "vitest";

import type { PhotoJourney } from "../../../../types/photoJourney";
import { visitReasoning } from "../visitReasoning";

const t = (key: string, options?: Record<string, unknown>): string =>
  key === "stats:distance.miles" ? "mi" : options ? `${key} ${JSON.stringify(options)}` : key;

const journey = {
  kind: "visit",
  photoCount: 41,
  locatedCount: 41,
  startLocal: "2026-10-05T16:58:00",
  endLocal: "2026-10-05T17:21:00",
  tripName: "Korea",
  nearestVisit: {
    placeId: "y",
    placeName: "Yongsan Station",
    distanceKm: 1.3,
    sameDay: false,
    withinReach: false,
  },
} as PhotoJourney;

describe("visitReasoning", () => {
  it("names the nearest visit's distance in the reader's unit", () => {
    const miles = visitReasoning(journey, t, "miles", "en").join(" | ");
    expect(miles).toContain('"distance":"0.8 mi"');
    const km = visitReasoning(journey, t, "kilometers", "de").join(" | ");
    expect(km).toContain('"distance":"1,3 stats:distance.kilometers"');
  });

  it("gives the time the photos span", () => {
    expect(visitReasoning(journey, t, "kilometers").join(" | ")).toContain('"minutes":23');
  });
});

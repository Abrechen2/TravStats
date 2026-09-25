import {
  greatCircleKm,
  instantToWallClock,
  mergeRailJourney,
  wallClockToInstant,
} from "../railJourneyWrite";

/**
 * The pure half of the rail write path: zones, instants and distance. The
 * route suite covers the same rules through HTTP; these pin the edge cases
 * that are awkward to reach from there.
 */
describe("railJourneyWrite", () => {
  it("reads a wall clock on the station's own zone, across a DST change", () => {
    expect(wallClockToInstant("2026-01-15T08:00", "Europe/Berlin").toISOString()).toBe(
      "2026-01-15T07:00:00.000Z"
    );
    expect(wallClockToInstant("2026-07-15T08:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-15T06:00:00.000Z"
    );
  });

  it("keeps the wall clock as UTC when no zone is known, rather than guessing one", () => {
    expect(wallClockToInstant("2026-07-15T08:00", null).toISOString()).toBe(
      "2026-07-15T08:00:00.000Z"
    );
  });

  it("round-trips an instant back to the station clock", () => {
    const instant = wallClockToInstant("2026-03-29T01:30", "Europe/Paris");
    expect(instantToWallClock(instant, "Europe/Paris")).toBe("2026-03-29T01:30");
  });

  it("measures Frankfurt to Paris as a straight line of about 478 km", () => {
    const km = greatCircleKm({ depLat: 50.1071, depLon: 8.6632, arrLat: 48.8768, arrLon: 2.3591 });
    expect(km).toBeGreaterThan(470);
    expect(km).toBeLessThan(485);
  });

  it("refuses an update of a journey that would leave it without a departure", () => {
    expect(() =>
      mergeRailJourney(null, {
        departureStation: { name: "A", lat: 50, lon: 8 },
        arrivalStation: { name: "B", lat: 48, lon: 2 },
      })
    ).toThrow("departureLocal is required");
  });

  it("derives the zone from coordinates and ignores any the client might imagine", () => {
    const state = mergeRailJourney(
      null,
      {
        departureStation: { name: "Wien Hbf", lat: 48.185, lon: 16.376 },
        arrivalStation: { name: "Zürich HB", lat: 47.378, lon: 8.54 },
        departureLocal: "2026-07-01T08:25",
      },
      new Date("2026-06-01T00:00:00Z")
    );
    expect(state.depTimezone).toBe("Europe/Vienna");
    expect(state.arrTimezone).toBe("Europe/Zurich");
    expect(state.status).toBe("scheduled");
  });
});

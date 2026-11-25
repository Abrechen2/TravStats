import { describe, it, expect } from "@jest/globals";
import { judgeCover, coverDays, type CoverContext, type CoverVisit } from "../covered";

/**
 * The shared "already recorded" rule (forgejo#439). Freiburg, 11 Nov 2026:
 * 18 photos at "Stadtverwaltung Freiburg" on the trip "Dienstreise Freiburg",
 * 331 m from the own place "Rathaus Verw.geb., Freiburg", which has a visit
 * that day on that trip — and the finding stayed pending.
 */
const RATHAUS = { lat: 47.9961, lon: 7.8494 };
/** 331 m north of the Rathaus. */
const PHOTOS = { lat: RATHAUS.lat + 331 / 111_195, lon: RATHAUS.lon };
const TRIP = "trip-freiburg";
const ZONE = "Europe/Berlin";

const target = (over: Partial<Parameters<typeof judgeCover>[0]> = {}) => ({
  startAt: new Date("2026-11-11T12:10:00Z"),
  endAt: new Date("2026-11-11T12:55:00Z"),
  ...PHOTOS,
  zone: ZONE,
  tripId: TRIP,
  ...over,
});

const visit = (over: Partial<CoverVisit> = {}): CoverVisit => ({
  id: "visit-1",
  tripId: TRIP,
  visitedAt: new Date("2026-11-11T09:30:00Z"),
  visitedAtUtc: new Date("2026-11-11T08:30:00Z"),
  visitedZone: ZONE,
  visitedPrecision: "minute",
  place: { id: "place-1", name: "Rathaus Verw.geb., Freiburg", ...RATHAUS, category: "landmark" },
  ...over,
});

const ctx = (visits: CoverVisit[], extra: Partial<CoverContext> = {}): CoverContext => ({
  visits,
  lodgingStays: [],
  ...extra,
});

describe("judgeCover — forgejo#439", () => {
  it("covers the Freiburg finding: 331 m, same day, same trip", () => {
    const { covered } = judgeCover(target(), ctx([visit()]));
    expect(covered).toMatchObject({
      kind: "visit",
      id: "visit-1",
      placeId: "place-1",
      name: "Rathaus Verw.geb., Freiburg",
      day: "2026-11-11",
    });
    expect(covered!.distanceM).toBeGreaterThan(320);
    expect(covered!.distanceM).toBeLessThan(340);
  });

  it("is covered by a visit on no trip, but not by one on another trip", () => {
    expect(judgeCover(target(), ctx([visit({ tripId: null })])).covered).not.toBeNull();
    expect(judgeCover(target(), ctx([visit({ tripId: "other-trip" })])).covered).toBeNull();
  });

  it("is not covered by a visit the day before a same-day stop", () => {
    const dayBefore = visit({ visitedAtUtc: new Date("2026-11-10T08:30:00Z") });
    expect(judgeCover(target(), ctx([dayBefore])).covered).toBeNull();
  });

  it("reaches one day either side for an overnight finding", () => {
    const overnight = target({
      startAt: new Date("2026-11-11T18:00:00Z"),
      endAt: new Date("2026-11-12T09:00:00Z"),
    });
    expect([...coverDays(overnight)]).toEqual([
      "2026-11-11",
      "2026-11-12",
      "2026-11-10",
      "2026-11-13",
    ]);
    const dayBefore = visit({ visitedAtUtc: new Date("2026-11-10T08:30:00Z") });
    expect(judgeCover(overnight, ctx([dayBefore])).covered).not.toBeNull();
  });

  it("keeps a point venue tight: a restaurant 331 m away covers nothing", () => {
    const cafe = visit({
      place: { id: "p", name: "Café", ...RATHAUS, category: "restaurant" },
    });
    expect(judgeCover(target(), ctx([cafe])).covered).toBeNull();
  });

  it("does not cover beyond the venue radius", () => {
    const far = target({ lat: RATHAUS.lat + 450 / 111_195 });
    expect(judgeCover(far, ctx([visit()])).covered).toBeNull();
  });

  it("is covered by a flight from the airport that day", () => {
    const airport = { lat: 47.59, lon: 7.53 };
    const verdict = judgeCover(
      target({ ...airport, tripId: null }),
      ctx([], {
        flights: [
          {
            id: "f1",
            flightNumber: "LH123",
            status: "flown",
            departureTime: new Date("2026-11-11T13:30:00Z"),
            arrivalTime: new Date("2026-11-11T14:40:00Z"),
            depIata: "BSL",
            depLat: airport.lat + 0.003,
            depLon: airport.lon,
            arrIata: "HAM",
            arrLat: 53.63,
            arrLon: 9.99,
          },
        ],
      })
    );
    expect(verdict.covered).toMatchObject({ kind: "flight", id: "f1", name: "LH123 · BSL" });
  });

  it("names an own place within reach that lacks only the visit", () => {
    const verdict = judgeCover(
      target(),
      ctx([], { places: [{ id: "place-1", name: "Rathaus", ...RATHAUS, category: "landmark" }] })
    );
    expect(verdict.covered).toBeNull();
    expect(verdict.nearPlace).toMatchObject({ id: "place-1", name: "Rathaus" });
  });
});

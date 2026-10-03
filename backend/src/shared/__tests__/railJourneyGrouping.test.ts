import { describe, it, expect } from "@jest/globals";

import {
  groupRailLegs,
  MAX_TRANSFER_MINUTES,
  sameStation,
  transferMinutes,
  type GroupableRailLeg,
} from "../railJourneyGrouping";

/**
 * forgejo#187 — the truth table of "which legs read as one journey". The rule
 * lives in `railJourneyGrouping.ts`; nothing here counts anything.
 */
const STATIONS = {
  koeln: { id: 1, name: "Köln Hbf", lat: 50.9432, lon: 6.9586 },
  frankfurt: { id: 2, name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632 },
  mannheim: { id: 3, name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697 },
  basel: { id: 4, name: "Basel SBB", lat: 47.5476, lon: 7.5897 },
} as const;
type StationKey = keyof typeof STATIONS;

let seq = 0;
function leg(
  from: StationKey,
  to: StationKey,
  departure: string,
  arrival: string | null,
  over: Partial<GroupableRailLeg> = {}
): GroupableRailLeg {
  seq += 1;
  const dep = STATIONS[from];
  const arr = STATIONS[to];
  return {
    id: `leg-${String(seq).padStart(3, "0")}`,
    bookingId: "b1",
    depStationId: dep.id,
    depStationName: dep.name,
    depLat: dep.lat,
    depLon: dep.lon,
    arrStationId: arr.id,
    arrStationName: arr.name,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime: new Date(departure),
    arrivalTime: arrival ? new Date(arrival) : null,
    depPrecision: "minute",
    arrPrecision: "minute",
    ...over,
  };
}

const ids = (groups: GroupableRailLeg[][]): string[][] => groups.map((g) => g.map((l) => l.id));

describe("groupRailLegs", () => {
  it("reads two legs of one booking that meet at a station as one journey", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    expect(ids(groupRailLegs([b, a]))).toEqual([[a.id, b.id]]);
  });

  it("chains three legs in travel order whatever order they arrive in", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "mannheim", "2025-03-01T08:20Z", "2025-03-01T08:58Z");
    const c = leg("mannheim", "basel", "2025-03-01T09:10Z", "2025-03-01T11:10Z");
    expect(ids(groupRailLegs([c, a, b]))).toEqual([[a.id, b.id, c.id]]);
  });

  it("leaves a leg without a booking alone, even beside a perfect continuation", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z", {
      bookingId: null,
    });
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z", {
      bookingId: null,
    });
    expect(ids(groupRailLegs([a, b]))).toEqual([[a.id], [b.id]]);
  });

  it("never joins legs of different bookings", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z", {
      bookingId: "b2",
    });
    expect(ids(groupRailLegs([a, b]))).toEqual([[a.id], [b.id]]);
  });

  it("breaks the chain where the stations do not meet", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("mannheim", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    expect(ids(groupRailLegs([a, b]))).toEqual([[a.id], [b.id]]);
  });

  it("splits a booking whose middle leg is missing into the two ends", () => {
    // Köln → Frankfurt and Mannheim → Basel are stored; Frankfurt → Mannheim
    // (the predecessor of the last leg) was deleted or never imported.
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const c = leg("mannheim", "basel", "2025-03-01T09:10Z", "2025-03-01T11:10Z");
    expect(ids(groupRailLegs([a, c]))).toEqual([[a.id], [c.id]]);
  });

  it("starts a new journey on the way back: a cycle is never one journey", () => {
    const out = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const back = leg("frankfurt", "koeln", "2025-03-01T09:00Z", "2025-03-01T10:05Z");
    expect(ids(groupRailLegs([out, back]))).toEqual([[out.id], [back.id]]);
  });

  it("splits a return ticket with changes into the outbound and the return", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    const c = leg("basel", "frankfurt", "2025-03-01T12:00Z", "2025-03-01T14:50Z");
    const d = leg("frankfurt", "koeln", "2025-03-01T15:05Z", "2025-03-01T16:10Z");
    expect(ids(groupRailLegs([a, b, c, d]))).toEqual([
      [a.id, b.id],
      [c.id, d.id],
    ]);
  });

  it("takes a wait of exactly the limit as a change, a minute more as a new journey", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:00Z");
    const atLimit = new Date(a.arrivalTime!.getTime() + MAX_TRANSFER_MINUTES * 60_000);
    const b = leg("frankfurt", "basel", atLimit.toISOString(), "2025-03-01T16:00Z");
    expect(groupRailLegs([a, b])).toHaveLength(1);
    const late = { ...b, departureTime: new Date(atLimit.getTime() + 60_000) };
    expect(groupRailLegs([a, late])).toHaveLength(2);
  });

  it("does not chain a leg that leaves before the previous one arrived", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "basel", "2025-03-01T08:00Z", "2025-03-01T11:10Z");
    expect(groupRailLegs([a, b])).toHaveLength(2);
  });

  it("abstains when the wait cannot be measured", () => {
    const noArrival = leg("koeln", "frankfurt", "2025-03-01T07:00Z", null);
    const next = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    expect(groupRailLegs([noArrival, next])).toHaveLength(2);

    const dayOnly = leg("koeln", "frankfurt", "2025-03-02T00:00Z", "2025-03-02T00:00Z", {
      arrPrecision: "day",
    });
    const after = leg("frankfurt", "basel", "2025-03-02T00:30Z", "2025-03-02T03:00Z");
    expect(groupRailLegs([dayOnly, after])).toHaveLength(2);
  });

  it("treats a precision written before the column existed as to the minute", () => {
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z", {
      arrPrecision: null,
    });
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z", {
      depPrecision: null,
    });
    expect(groupRailLegs([a, b])).toHaveLength(1);
  });

  it("orders journeys by first departure and keeps every leg exactly once", () => {
    const late = leg("koeln", "basel", "2025-05-01T07:00Z", null, { bookingId: null });
    const a = leg("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = leg("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    const early = leg("basel", "koeln", "2025-01-01T07:00Z", null, { bookingId: null });
    const groups = groupRailLegs([late, b, early, a]);
    expect(ids(groups)).toEqual([[early.id], [a.id, b.id], [late.id]]);
    expect(groups.flat()).toHaveLength(4);
  });

  it("answers an empty logbook with no journeys", () => {
    expect(groupRailLegs([])).toEqual([]);
  });
});

describe("sameStation", () => {
  const frankfurt = STATIONS.frankfurt;
  it("matches the same catalogue row", () => {
    expect(sameStation(frankfurt, { ...frankfurt, name: "FFM", lat: 0, lon: 0 })).toBe(true);
  });
  it("matches the same recorded name, case and padding aside", () => {
    expect(
      sameStation(
        { id: null, name: " frankfurt (main) hbf ", lat: 0, lon: 0 },
        { ...frankfurt, id: null }
      )
    ).toBe(true);
  });
  it("matches two records of one place a few hundred metres apart", () => {
    expect(
      sameStation(
        { id: 8, name: "Frankfurt Hbf (tief)", lat: 50.1075, lon: 8.664 },
        { ...frankfurt, id: 9 }
      )
    ).toBe(true);
  });
  it("does not match two different stations", () => {
    expect(sameStation(frankfurt, STATIONS.mannheim)).toBe(false);
  });
});

describe("transferMinutes", () => {
  it("is null without an arrival, a number otherwise", () => {
    const next = { departureTime: new Date("2025-03-01T08:20Z"), depPrecision: "minute" };
    expect(transferMinutes({ arrivalTime: null, arrPrecision: null }, next)).toBeNull();
    expect(
      transferMinutes({ arrivalTime: new Date("2025-03-01T08:05Z"), arrPrecision: "minute" }, next)
    ).toBe(15);
  });
});

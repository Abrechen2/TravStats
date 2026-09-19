/**
 * The time-of-day and day-of-week buckets are read on the DEPARTURE AIRPORT'S
 * clock, not on the clock of the machine running the engine.
 *
 * They were not. The 2026-09-19 integrity audit booted CT106 with
 * TZ=Europe/Berlin and watched NOT_A_MORNING_PERSON leave two users and arrive
 * on a third, dated that day — the same flights, a different container. The
 * same boot under TZ=UTC moved nothing.
 *
 * Every case below is chosen so that the three readings — UTC, Europe/Berlin,
 * and the airport's own zone — disagree. On the old code the two runs return
 * different numbers; on the new one both return the airport's.
 *
 * Direct unit test of `calculateUserStats`; mocks the airport cache so it needs
 * no Postgres.
 */

import { calculateUserStats, type FlightData, type UserStats } from "../utils/achievementStats";

const AIRPORT_DB: Record<
  string,
  { country: string | null; lat: number; lon: number; timezone: string | null }
> = {
  // UTC+2 in April (CEST).
  FRA: { country: "Germany", lat: 50.0379, lon: 8.5622, timezone: "Europe/Berlin" },
  // UTC+8 all year — far enough from both process zones to move a weekday.
  SIN: { country: "Singapore", lat: 1.3644, lon: 103.9915, timezone: "Asia/Singapore" },
  // Deliberately zone-less: the fallback must be UTC, never the process zone.
  XXX: { country: null, lat: 0, lon: 0, timezone: null },
};

jest.mock("../services/airportCache", () => ({
  getCachedAirports: jest.fn(async (codes: string[]) => {
    const map = new Map<string, unknown>();
    for (const code of codes) {
      const upper = code.toUpperCase();
      if (AIRPORT_DB[upper]) map.set(upper, AIRPORT_DB[upper]);
    }
    return map;
  }),
}));

function makeFlight(opts: {
  depIata: keyof typeof AIRPORT_DB;
  arrIata: keyof typeof AIRPORT_DB;
  departureTime: Date;
}): FlightData {
  const dep = AIRPORT_DB[opts.depIata];
  const arr = AIRPORT_DB[opts.arrIata];
  return {
    id: `${opts.depIata}-${opts.arrIata}-${opts.departureTime.toISOString()}`,
    status: "flown",
    depIata: opts.depIata,
    depIcao: null,
    arrIata: opts.arrIata,
    arrIcao: null,
    depLat: dep.lat,
    depLon: dep.lon,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime: opts.departureTime,
    arrivalTime: new Date(opts.departureTime.getTime() + 2 * 60 * 60 * 1000),
    depTimeSemantics: "UTC",
    airline: "Lufthansa",
    aircraft: null,
    flightNumber: null,
    seatNumber: null,
    seatClass: null,
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
    specialType: null,
  };
}

let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env.TZ;
});

afterAll(() => {
  // `process.env.TZ = undefined` writes the STRING "undefined", which Node
  // cannot parse as a zone and falls back to UTC for — so this file would have
  // silently moved every suite that ran after it off the machine's clock.
  // Deleting is the only way to restore "was not set".
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Run the engine with the process clock set to `tz`. */
async function statsUnder(tz: string, flights: FlightData[]): Promise<UserStats> {
  process.env.TZ = tz;
  return calculateUserStats(flights);
}

interface Buckets {
  nightFlights: number;
  weekendFlights: number;
  redEyeFlights: number;
  earlyMorningFlights: number;
}

function bucketsOf(stats: UserStats): Buckets {
  return {
    nightFlights: stats.nightFlights,
    weekendFlights: stats.weekendFlights,
    redEyeFlights: stats.redEyeFlights,
    earlyMorningFlights: stats.earlyMorningFlights,
  };
}

describe("calculateUserStats — the departure airport's clock, not the process clock", () => {
  it("buckets a Frankfurt dawn departure the same under TZ=UTC and TZ=Europe/Berlin", async () => {
    // 03:30 UTC is 05:30 in Frankfurt on 10 April 2024 (CEST, UTC+2).
    //   airport local 05:30 → night (<06), early morning (04–07), NOT a red-eye
    //   process UTC   03:30 → night, red-eye (<05), NOT early morning
    // The two readings disagree on two buckets, which is what makes the old
    // behaviour visible.
    const flights = [
      makeFlight({
        depIata: "FRA",
        arrIata: "SIN",
        departureTime: new Date("2024-04-10T03:30:00Z"),
      }),
    ];

    const asUtc = bucketsOf(await statsUnder("UTC", flights));
    const asBerlin = bucketsOf(await statsUnder("Europe/Berlin", flights));

    expect(asUtc).toEqual(asBerlin);
    expect(asUtc).toEqual({
      nightFlights: 1,
      weekendFlights: 0, // Wednesday in every reading
      redEyeFlights: 0,
      earlyMorningFlights: 1,
    });
  });

  it("reads the weekday in Singapore, where the date has already turned", async () => {
    // 17:00 UTC on Sunday 14 April 2024 is Monday 01:00 in Singapore (UTC+8).
    // Both process zones still say Sunday; the airport says Monday, so this is
    // not a weekend flight.
    const flights = [
      makeFlight({
        depIata: "SIN",
        arrIata: "FRA",
        departureTime: new Date("2024-04-14T17:00:00Z"),
      }),
    ];

    const asUtc = bucketsOf(await statsUnder("UTC", flights));
    const asBerlin = bucketsOf(await statsUnder("Europe/Berlin", flights));

    expect(asUtc).toEqual(asBerlin);
    expect(asUtc.weekendFlights).toBe(0);
    // 01:00 local: a night flight and a red-eye, and too early to be a morning.
    expect(asUtc.nightFlights).toBe(1);
    expect(asUtc.redEyeFlights).toBe(1);
    expect(asUtc.earlyMorningFlights).toBe(0);
  });

  it("falls back to UTC — never the process zone — when the airport has no timezone", async () => {
    // 23:30 UTC. Read in UTC that is a red-eye; read in Berlin it is 01:30 the
    // next day, which is also a red-eye but a different calendar month key at
    // the turn of a month. The zone-less airport must land on the UTC reading.
    const flights = [
      makeFlight({
        depIata: "XXX",
        arrIata: "FRA",
        departureTime: new Date("2024-04-30T23:30:00Z"),
      }),
    ];

    const asUtc = await statsUnder("UTC", flights);
    const asBerlin = await statsUnder("Europe/Berlin", flights);

    expect(bucketsOf(asUtc)).toEqual(bucketsOf(asBerlin));
    expect(asUtc.redEyeFlights).toBe(1);
    // April, not May: the stored components stand when no zone is known.
    expect(Array.from(asBerlin.monthsWithFlights)).toEqual(["2024-04"]);
  });
});

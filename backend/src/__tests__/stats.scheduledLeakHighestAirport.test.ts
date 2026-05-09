/**
 * Regression: scheduled flights must not contribute to `uniqueStats.highestAirport`
 * (or any other unique stat). The user reported a still-scheduled flight to
 * Addis Ababa (ADD/HAAB, altitude 2326 m) showing up as the "Highest Airport"
 * on the Stats page despite not having been flown yet.
 *
 * Pipeline under test:
 *   1. `GET /api/v1/stats/unique` filters Prisma to `status: 'flown'`
 *      (`backend/src/routes/stats.ts:509`).
 *   2. `calculateUniqueStats` further narrows to `f.status === 'flown'`
 *      (`backend/src/utils/stats/uniqueStats.ts:20-23`).
 *   3. `airportCodes` is built only from those flown flights.
 *   4. `getCachedAirports(codes)` resolves IATA/ICAO → airport metadata.
 *   5. The altitude scan walks the returned Map and picks the maximum.
 *
 * If a scheduled flight's destination ends up in the airportCodes set, the
 * altitude lookup will surface it. This test exercises step 2-5 directly:
 * given a mixed set of `scheduled` + `flown` flights (the kind the function
 * would receive if upstream filtering ever regressed), the highestAirport
 * MUST come from the flown leg only.
 */

import { calculateUniqueStats } from '../utils/statsCalculator';
import type { FlightData } from '../utils/statsCalculator';

// Mock the airport cache so the test does not depend on a seeded Postgres.
// The mock returns altitude data for every airport code the engine asks for;
// the bug being guarded against would manifest as Addis Ababa (ADD/HAAB,
// 2326 m) winning over Munich (MUC/EDDM, 453 m) in the highestAirport scan
// because the engine asked the cache for ADD/HAAB despite the Addis flight
// being status: 'scheduled'.
const AIRPORT_DB: Record<
  string,
  { iata: string | null; icao: string | null; name: string; altitude: number; lat: number; lon: number; country: string; timezone: string }
> = {
  FRA: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt Airport', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'Germany', timezone: 'Europe/Berlin' },
  EDDF: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt Airport', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'Germany', timezone: 'Europe/Berlin' },
  MUC: { iata: 'MUC', icao: 'EDDM', name: 'Munich Airport', altitude: 453, lat: 48.3538, lon: 11.7861, country: 'Germany', timezone: 'Europe/Berlin' },
  EDDM: { iata: 'MUC', icao: 'EDDM', name: 'Munich Airport', altitude: 453, lat: 48.3538, lon: 11.7861, country: 'Germany', timezone: 'Europe/Berlin' },
  ADD: { iata: 'ADD', icao: 'HAAB', name: 'Addis Ababa Bole International Airport', altitude: 2326, lat: 8.9778, lon: 38.7993, country: 'Ethiopia', timezone: 'Africa/Addis_Ababa' },
  HAAB: { iata: 'ADD', icao: 'HAAB', name: 'Addis Ababa Bole International Airport', altitude: 2326, lat: 8.9778, lon: 38.7993, country: 'Ethiopia', timezone: 'Africa/Addis_Ababa' },
};

jest.mock('../services/airportCache', () => ({
  getCachedAirports: jest.fn(async (codes: string[]) => {
    const map = new Map<string, unknown>();
    for (const code of codes) {
      const upper = code.toUpperCase();
      if (AIRPORT_DB[upper]) {
        map.set(upper, AIRPORT_DB[upper]);
      }
    }
    return map;
  }),
}));

function flight(partial: Partial<FlightData> & {
  depIata: string;
  arrIata: string;
  depIcao: string;
  arrIcao: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  status: string;
  departureTime: Date;
  arrivalTime: Date;
}): FlightData {
  return {
    id: `f-${partial.depIata}-${partial.arrIata}-${partial.departureTime.toISOString()}`,
    airline: 'Lufthansa',
    aircraft: null,
    price: null,
    taxes: null,
    fees: null,
    category: null,
    seatClass: null,
    createdAt: new Date(),
    ...partial,
  };
}

describe('calculateUniqueStats — scheduled flights must not leak into highestAirport', () => {
  it('returns Munich (flown) as highest, not Addis Ababa (scheduled)', async () => {
    // Baseline: a flown leg between two low-altitude airports (FRA → MUC).
    // Munich at 453 m is the only altitude that may surface.
    const flownFraMuc = flight({
      depIata: 'FRA',
      depIcao: 'EDDF',
      arrIata: 'MUC',
      arrIcao: 'EDDM',
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 48.3538,
      arrLon: 11.7861,
      status: 'flown',
      departureTime: new Date('2025-04-01T08:00:00Z'),
      arrivalTime: new Date('2025-04-01T09:00:00Z'),
    });

    // The bug: a future-dated scheduled leg to Addis Ababa (2326 m).
    // If the engine ever asks the airport cache for ADD/HAAB, the altitude
    // scan will surface it as the highest airport — that is the regression.
    const scheduledFraAdd = flight({
      depIata: 'FRA',
      depIcao: 'EDDF',
      arrIata: 'ADD',
      arrIcao: 'HAAB',
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 8.9778,
      arrLon: 38.7993,
      status: 'scheduled',
      // 30 days in the future from the test's perspective is irrelevant —
      // the engine should only look at status, not date.
      departureTime: new Date('2027-06-15T10:00:00Z'),
      arrivalTime: new Date('2027-06-15T18:00:00Z'),
    });

    const result = await calculateUniqueStats([flownFraMuc, scheduledFraAdd], []);

    // Highest airport must be Munich (453 m). It must NOT be Addis Ababa
    // (2326 m) — that flight is still scheduled.
    expect(result.highestAirport).not.toBeNull();
    expect(result.highestAirport?.code).not.toBe('ADD');
    expect(result.highestAirport?.code).not.toBe('HAAB');
    expect(result.highestAirport?.name).not.toContain('Addis');
    // Positive assertion: it should be Munich (the only flown destination
    // with altitude data in this fixture).
    expect(result.highestAirport?.altitude).toBe(453);
    expect(['MUC', 'EDDM']).toContain(result.highestAirport?.code);
  });

  it('returns null when only scheduled flights exist (no flown legs)', async () => {
    // Edge case: a brand-new user with only a single scheduled flight to
    // Addis Ababa must see highestAirport = null, not ADD.
    const scheduledOnly = flight({
      depIata: 'FRA',
      depIcao: 'EDDF',
      arrIata: 'ADD',
      arrIcao: 'HAAB',
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 8.9778,
      arrLon: 38.7993,
      status: 'scheduled',
      departureTime: new Date('2027-06-15T10:00:00Z'),
      arrivalTime: new Date('2027-06-15T18:00:00Z'),
    });

    const result = await calculateUniqueStats([scheduledOnly], []);

    expect(result.highestAirport).toBeNull();
  });

  it('still surfaces Addis Ababa once the flight has flipped to flown', async () => {
    // Sanity: when the same flight transitions from scheduled to flown
    // (post-trip), Addis Ababa SHOULD become the highest airport. This
    // guards against an over-eager fix that filters out ADD entirely.
    const flownFraAdd = flight({
      depIata: 'FRA',
      depIcao: 'EDDF',
      arrIata: 'ADD',
      arrIcao: 'HAAB',
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 8.9778,
      arrLon: 38.7993,
      status: 'flown',
      departureTime: new Date('2025-09-01T10:00:00Z'),
      arrivalTime: new Date('2025-09-01T18:00:00Z'),
    });

    const result = await calculateUniqueStats([flownFraAdd], []);

    expect(result.highestAirport).not.toBeNull();
    expect(['ADD', 'HAAB']).toContain(result.highestAirport?.code);
    expect(result.highestAirport?.altitude).toBe(2326);
  });
});

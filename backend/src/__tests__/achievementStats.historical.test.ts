/**
 * Historical flights must contribute to achievements that count flights
 * (`flights_count`, `distance_km`, `airports_count`, etc.) but must NOT
 * inflate time-of-day buckets (nightFlights, weekendFlights, redEyeFlights,
 * earlyMorningFlights) because historical placeholder times are unreliable.
 *
 * Direct unit-test of `calculateUserStats`; mocks the airport cache to keep
 * the test independent of Postgres.
 */

import { calculateUserStats, type FlightData } from '../utils/achievementStats';

const AIRPORT_DB: Record<
  string,
  { country: string | null; lat: number; lon: number }
> = {
  FRA: { country: 'Germany', lat: 50.0379, lon: 8.5622 },
  MUC: { country: 'Germany', lat: 48.3538, lon: 11.7861 },
  JFK: { country: 'United States', lat: 40.6398, lon: -73.7789 },
};

jest.mock('../services/airportCache', () => ({
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
  status: 'flown' | 'historical' | 'scheduled' | 'cancelled';
  depIata: keyof typeof AIRPORT_DB;
  arrIata: keyof typeof AIRPORT_DB;
  departureTime: Date | null;
  arrivalTime?: Date | null;
}): FlightData {
  const dep = AIRPORT_DB[opts.depIata];
  const arr = AIRPORT_DB[opts.arrIata];
  return {
    id: `${opts.depIata}-${opts.arrIata}-${opts.departureTime?.toISOString() ?? 'na'}`,
    status: opts.status,
    depIata: opts.depIata,
    depIcao: null,
    arrIata: opts.arrIata,
    arrIcao: null,
    depLat: dep.lat,
    depLon: dep.lon,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime: opts.departureTime,
    arrivalTime: opts.arrivalTime ?? null,
    airline: 'Lufthansa',
    aircraft: null,
    flightNumber: null,
    seatNumber: null,
    seatClass: null,
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
  };
}

describe('calculateUserStats — historical flight inclusion', () => {
  it('counts historical flights in flightsCount', async () => {
    const flights: FlightData[] = [
      makeFlight({
        status: 'flown',
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
      }),
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
      }),
    ];
    const stats = await calculateUserStats(flights);
    expect(stats.flightsCount).toBe(2);
    // Distance and airports include historical too (the main loop iterates
    // over every input flight).
    expect(stats.airports.size).toBe(3); // FRA, MUC, JFK
    expect(stats.totalDistance).toBeGreaterThan(6000); // FRA→JFK ≈ 6200 km
    expect(stats.countries.size).toBe(2); // Germany + United States
  });

  it('excludes historical flights from time-of-day buckets', async () => {
    const flights: FlightData[] = [
      // Historical placeholder at midnight on a Saturday — would otherwise
      // bump nightFlights AND weekendFlights AND redEyeFlights.
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-18T03:00:00Z'), // Saturday 03:00
        arrivalTime: new Date('1989-03-18T11:00:00Z'),
      }),
    ];
    const stats = await calculateUserStats(flights);
    // Historical alone → no time-of-day stats should fire.
    expect(stats.nightFlights).toBe(0);
    expect(stats.weekendFlights).toBe(0);
    expect(stats.redEyeFlights).toBe(0);
    expect(stats.earlyMorningFlights).toBe(0);
    // But the flight still counted toward flightsCount.
    expect(stats.flightsCount).toBe(1);
  });
});

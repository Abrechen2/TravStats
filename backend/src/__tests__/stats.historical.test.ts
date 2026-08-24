/**
 * Selective inclusion of historical flights in stats.
 *
 * Historical flights are real past flights from old logbooks (the user
 * remembers the date but not precise times). They satisfy NOT-NULL
 * constraints with placeholder/best-effort timestamps, so:
 *   - Time-insensitive stats (airport/country/distance/airline/category) MUST
 *     count them.
 *   - Time-sensitive stats (time-of-day, layovers, durations, midnight
 *     crossings, fastest route) MUST NOT count them — placeholders would
 *     skew results.
 *
 * This test exercises the four helpers (`calculateAirportStats`,
 * `calculateFunStats`, `calculateBusinessStats`, `calculateUniqueStats`)
 * with mixed `flown` + `historical` input and asserts the split.
 */

import {
  calculateAirportStats,
  calculateBusinessStats,
  calculateFunStats,
  calculateUniqueStats,
} from '../utils/statsCalculator';
import type { FlightData } from '../utils/statsCalculator';

const AIRPORT_DB: Record<
  string,
  {
    iata: string | null;
    icao: string | null;
    name: string;
    altitude: number;
    lat: number;
    lon: number;
    country: string;
    timezone: string;
  }
> = {
  // `country` is a 2-letter ISO code so it resolves correctly in
  // airportStats' continent map (DE/US/GB → EU/NA/EU).
  FRA: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  MUC: { iata: 'MUC', icao: 'EDDM', name: 'Munich',    altitude: 453, lat: 48.3538, lon: 11.7861, country: 'DE', timezone: 'Europe/Berlin' },
  JFK: { iata: 'JFK', icao: 'KJFK', name: 'JFK',       altitude:  13, lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
  LHR: { iata: 'LHR', icao: 'EGLL', name: 'Heathrow',  altitude:  25, lat: 51.4700, lon: -0.4543,  country: 'GB', timezone: 'Europe/London' },
  EDDF: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  EDDM: { iata: 'MUC', icao: 'EDDM', name: 'Munich',    altitude: 453, lat: 48.3538, lon: 11.7861, country: 'DE', timezone: 'Europe/Berlin' },
  KJFK: { iata: 'JFK', icao: 'KJFK', name: 'JFK',       altitude:  13, lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
  EGLL: { iata: 'LHR', icao: 'EGLL', name: 'Heathrow',  altitude:  25, lat: 51.4700, lon: -0.4543,  country: 'GB', timezone: 'Europe/London' },
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

interface MakeFlightOpts {
  id?: string;
  status?: 'flown' | 'historical';
  depIata: keyof typeof AIRPORT_DB;
  arrIata: keyof typeof AIRPORT_DB;
  departureTime: Date;
  arrivalTime: Date;
  airline?: string | null;
  seatClass?: string | null;
  category?: string | null;
}

function makeFlight(opts: MakeFlightOpts): FlightData {
  const dep = AIRPORT_DB[opts.depIata];
  const arr = AIRPORT_DB[opts.arrIata];
  return {
    id: opts.id ?? `${opts.depIata}-${opts.arrIata}-${opts.departureTime.toISOString()}`,
    status: opts.status ?? 'flown',
    depIata: opts.depIata,
    depIcao: dep.icao,
    arrIata: opts.arrIata,
    arrIcao: arr.icao,
    depLat: dep.lat,
    depLon: dep.lon,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime: opts.departureTime,
    arrivalTime: opts.arrivalTime,
    airline: opts.airline ?? 'Lufthansa',
    aircraft: null,
    price: null,
    taxes: null,
    fees: null,
    category: opts.category ?? null,
    seatClass: opts.seatClass ?? null,
    createdAt: new Date(),
  };
}

describe('calculateAirportStats — historical flights', () => {
  it('counts historical flights toward airport, country, and continent totals', async () => {
    const flights: FlightData[] = [
      // One modern flown flight FRA→MUC
      makeFlight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
      }),
      // Historical FRA→JFK from an old logbook (1989)
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
      }),
    ];
    const stats = await calculateAirportStats(flights, []);
    // 3 distinct airports (FRA, MUC, JFK) — historical contributed JFK.
    expect(stats.airportCount).toBe(3);
    // 2 distinct countries (Germany, United States).
    expect(stats.countryCount).toBe(2);
    // 2 distinct continents (EU, NA).
    expect(stats.continentCount).toBe(2);
  });

  it('returns empty stats when there are only scheduled/cancelled flights', async () => {
    const flights: FlightData[] = [
      makeFlight({
        status: 'flown',
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
      }),
    ];
    flights[0] = { ...flights[0], status: 'scheduled' };
    const stats = await calculateAirportStats(flights, []);
    expect(stats.airportCount).toBe(0);
  });
});

describe('calculateFunStats — historical flights', () => {
  it('counts historical flights toward distance/airline/route stats', async () => {
    const flights: FlightData[] = [
      makeFlight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
        airline: 'Lufthansa',
      }),
      // Two historical FRA→JFK flights — airline still Lufthansa.
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
        airline: 'Lufthansa',
      }),
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1991-07-22T12:00:00Z'),
        arrivalTime: new Date('1991-07-22T20:00:00Z'),
        airline: 'Lufthansa',
      }),
    ];
    const stats = await calculateFunStats(flights);
    // Long-haul (>=5000km) FRA→JFK ≈ 6200 km — both historical legs count.
    expect(stats.longHaulPilot).toBe(2);
    // Short-haul (<500km) FRA→MUC ≈ 300 km — the modern leg counts.
    expect(stats.shortHaulKing).toBe(1);
    // All 3 flights are Lufthansa → loyalty = 100%.
    expect(stats.loyaltyScore).toBe(100);
    expect(stats.mostUsedAirline).toBe('Lufthansa');
    // Most frequent route is FRA-JFK with 2 occurrences.
    expect(stats.routeMaster).toBe('FRA-JFK');
    expect(stats.routeMasterCount).toBe(2);
  });

  it('does NOT count historical flights toward time-of-day / weekend buckets', async () => {
    const flights: FlightData[] = [
      // Historical placeholder time at 12:00 (afternoon) on a Saturday.
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-18T12:00:00Z'), // Saturday
        arrivalTime: new Date('1989-03-18T20:00:00Z'),
      }),
    ];
    const stats = await calculateFunStats(flights);
    // No flown flights → all time buckets should be 0.
    expect(stats.earlyBird).toBe(0);
    expect(stats.afternoon).toBe(0);
    expect(stats.nightOwl).toBe(0);
    expect(stats.weekendWarrior).toBe(0);
  });
});

describe('calculateBusinessStats — historical flights', () => {
  it('counts historical flights toward distance/category/seat-class', () => {
    const flights: FlightData[] = [
      makeFlight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
        seatClass: 'economy',
        category: 'business',
      }),
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
        seatClass: 'business',
        category: 'business',
      }),
    ];
    const stats = calculateBusinessStats(flights);
    // Both flights are category 'business' → most common category.
    expect(stats.mostCommonCategory).toBe('business');
    // Two distinct seat classes counted (economy + business).
    expect(Object.keys(stats.seatClassDistribution).sort()).toEqual([
      'business',
      'economy',
    ]);
    // Airport diversity = 3 (FRA, MUC, JFK) — historical contributed JFK.
    expect(stats.airportDiversity).toBe(3);
    // totalDistance includes historical FRA→JFK (~6200 km) plus FRA→MUC (~300 km).
    expect(stats.totalDistance).toBeGreaterThan(6000);
  });

  // Superseded by #268. The rule this test guards — a historical row's
  // placeholder clocks must never be measured — is UNCHANGED and asserted
  // below. What changed is the consequence: contributing 0 made this average
  // disagree with the overview card, which showed the identical German label on
  // the same screen and estimated the very same flights. The row now
  // contributes a great-circle estimate, so both places answer alike.
  it("never measures a historical row's placeholder times, but does estimate it", () => {
    const flights: FlightData[] = [
      // Historical with a placeholder 8-hour "duration".
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        // A one-hour placeholder for a transatlantic crossing. Deliberately
        // absurd: the great-circle estimate for FRA→JFK lands on ~8 h, so a
        // plausible-looking placeholder would make this test pass either way.
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T13:00:00Z'),
      }),
    ];
    const stats = calculateBusinessStats(flights);
    // NOT the 1 h the placeholder timestamps would have measured — that is the
    // fiction this test exists to keep out.
    expect(stats.avgFlightDuration).not.toBe(1);
    // FRA→JFK is ~6200 km; at the estimator's 800 km/h plus 15 min of ground
    // that is right around 8 h. A real figure, derived from coordinates.
    expect(stats.avgFlightDuration).toBeGreaterThan(7);
    expect(stats.avgFlightDuration).toBeLessThan(9);
  });
});

describe('calculateUniqueStats — historical flights', () => {
  it('counts historical flights toward continent / hemisphere / international stats', async () => {
    const flights: FlightData[] = [
      makeFlight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2024-04-10T08:00:00Z'),
        arrivalTime: new Date('2024-04-10T09:00:00Z'),
      }),
      // Historical FRA→JFK is international (DE→US) and crosses to NA.
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
      }),
    ];
    const stats = await calculateUniqueStats(flights, []);
    // 2 continents (Europe, North America) — historical contributed NA.
    expect(stats.continentalExplorer).toBe(2);
    // International flights >= 1 (FRA→JFK).
    expect(stats.internationalVsDomestic.international).toBeGreaterThanOrEqual(1);
    // Ocean crossings >= 1 (FRA→JFK > 5000 km).
    expect(stats.oceanCrossings).toBeGreaterThanOrEqual(1);
  });

  it('does NOT count historical flights toward time-sensitive stats', async () => {
    const flights: FlightData[] = [
      // Historical placeholder times — would be a "midnight" or "fastest"
      // candidate if naively included.
      makeFlight({
        status: 'historical',
        depIata: 'FRA',
        arrIata: 'JFK',
        departureTime: new Date('1989-03-15T12:00:00Z'),
        arrivalTime: new Date('1989-03-15T20:00:00Z'),
      }),
    ];
    const stats = await calculateUniqueStats(flights, []);
    // No flown flights → no layovers, no fastest route, no midnight flights.
    expect(stats.longestLayover).toBeNull();
    expect(stats.shortestLayover).toBeNull();
    expect(stats.fastestRoute).toBeNull();
    expect(stats.midnightFlights).toBe(0);
    expect(stats.timeTravelIndex).toBe(0);
  });
});

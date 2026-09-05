/**
 * forgejo#76 — a flown row saved with a date and no times carries placeholder
 * clocks ("12:00 → 13:00"). Three aggregates subtracted those placeholders as
 * if they were measured, while the overview beside them estimated the same row
 * from its coordinates. Each aggregate now goes through the shared rule.
 *
 * Every case pairs a DATE_ONLY row with clocks one hour apart against a route
 * (FRA → JFK) whose estimate is about eight hours — so the old arithmetic and
 * the new rule cannot agree by coincidence.
 */
import { calculateBusinessStats } from '../utils/statsCalculator';
import type { FlightData } from '../utils/statsCalculator';
import {
  calculateUserStats,
  type FlightData as AchievementFlight,
} from '../utils/achievementStats';

const AIRPORT_DB: Record<string, { iata: string; icao: string; name: string; altitude: number; lat: number; lon: number; country: string; timezone: string }> = {
  FRA: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  JFK: { iata: 'JFK', icao: 'KJFK', name: 'JFK', altitude: 13, lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
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

const PLACEHOLDER_DEP = new Date('1989-03-15T12:00:00Z');
const PLACEHOLDER_ARR = new Date('1989-03-15T13:00:00Z');

function statsFlight(semantics: string): FlightData {
  return {
    id: `FRA-JFK-${semantics}`,
    status: 'flown',
    depIata: 'FRA',
    depIcao: 'EDDF',
    arrIata: 'JFK',
    arrIcao: 'KJFK',
    depLat: AIRPORT_DB.FRA.lat,
    depLon: AIRPORT_DB.FRA.lon,
    arrLat: AIRPORT_DB.JFK.lat,
    arrLon: AIRPORT_DB.JFK.lon,
    departureTime: PLACEHOLDER_DEP,
    arrivalTime: PLACEHOLDER_ARR,
    depTimeSemantics: semantics,
    airline: 'Lufthansa',
    aircraft: null,
    price: 800,
    priceBase: 800,
    taxes: null,
    fees: null,
    category: null,
    seatClass: null,
    createdAt: new Date(),
  };
}

function achievementFlight(semantics: string): AchievementFlight {
  return {
    id: `FRA-JFK-${semantics}`,
    status: 'flown',
    depIata: 'FRA',
    depIcao: null,
    arrIata: 'JFK',
    arrIcao: null,
    depLat: AIRPORT_DB.FRA.lat,
    depLon: AIRPORT_DB.FRA.lon,
    arrLat: AIRPORT_DB.JFK.lat,
    arrLon: AIRPORT_DB.JFK.lon,
    departureTime: PLACEHOLDER_DEP,
    arrivalTime: PLACEHOLDER_ARR,
    depTimeSemantics: semantics,
    airline: 'Lufthansa',
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

describe('business stats — a DATE_ONLY row is estimated, its placeholder clocks are not measured', () => {
  it('cost per hour uses the coordinate estimate, not the one-hour placeholder', () => {
    const stats = calculateBusinessStats([statsFlight('DATE_ONLY')]);
    // 800 € over the placeholder hour would be 800 €/h; over the ~8 h estimate
    // it is about 100 €/h.
    expect(stats.costPerHour).toBeGreaterThan(80);
    expect(stats.costPerHour).toBeLessThan(125);
  });

  it('still measures a UTC row with the same clocks', () => {
    const stats = calculateBusinessStats([statsFlight('UTC')]);
    expect(stats.costPerHour).toBe(800);
    expect(stats.avgFlightDuration).toBe(1);
  });

  it('the average duration counts the row as an estimate', () => {
    const stats = calculateBusinessStats([statsFlight('DATE_ONLY')]);
    expect(stats.avgFlightDuration).toBeGreaterThan(6.5);
    expect(stats.avgFlightDuration).toBeLessThan(9.5);
  });
});

describe('achievement stats — hours in the air follow the shared rule', () => {
  it('a DATE_ONLY row contributes its estimate, not the placeholder hour', async () => {
    const stats = await calculateUserStats([achievementFlight('DATE_ONLY')]);
    expect(stats.totalFlightHours).toBeGreaterThan(6.5);
    expect(stats.totalFlightHours).toBeLessThan(9.5);
  });

  it('a UTC row contributes the measured hour', async () => {
    const stats = await calculateUserStats([achievementFlight('UTC')]);
    expect(stats.totalFlightHours).toBe(1);
  });
});

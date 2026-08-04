import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { calculateDistance } from '../utils/geo';
import { calculateCo2Kg, toSeatClass } from '../services/co2Calculator';

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockGroupBy = jest.fn();
const mockGetCachedAirports = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: {
      findMany: mockFindMany,
      count: mockCount,
      groupBy: mockGroupBy,
    },
  },
}));
jest.mock('../services/airportCache', () => ({
  getCachedAirports: mockGetCachedAirports,
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));

import request from 'supertest';
import express from 'express';

// Fixture airports — 2-letter ISO country codes so the country/airport
// counting in calculateAirportStats resolves deterministically.
const AIRPORT_DB: Record<
  string,
  { lat: number; lon: number; country: string; timezone: string }
> = {
  FRA: { lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  EDDF: { lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  MUC: { lat: 48.3538, lon: 11.7861, country: 'DE', timezone: 'Europe/Berlin' },
  EDDM: { lat: 48.3538, lon: 11.7861, country: 'DE', timezone: 'Europe/Berlin' },
  JFK: { lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
  KJFK: { lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
};

describe('GET /api/v1/stats/hero', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFindMany.mockReset();
    mockCount.mockReset();
    mockGroupBy.mockReset();
    mockGetCachedAirports.mockReset();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('composes distanceKm/flights/flightTimeMinutes from computeSummary and countries/airports/co2Kg from the airport+fun calculators', async () => {
    mockGetCachedAirports.mockImplementation(async (...args: unknown[]) => {
      const codes = args[0] as string[];
      const map = new Map<string, unknown>();
      for (const code of codes) {
        const upper = code.toUpperCase();
        if (AIRPORT_DB[upper]) map.set(upper, AIRPORT_DB[upper]);
      }
      return map;
    });

    // Flight A: FRA -> MUC, flown, 2024-04-10 08:00-09:00 UTC (60 min).
    const flightA = {
      id: 'a',
      depIata: 'FRA',
      depIcao: 'EDDF',
      arrIata: 'MUC',
      arrIcao: 'EDDM',
      depLat: AIRPORT_DB.FRA.lat,
      depLon: AIRPORT_DB.FRA.lon,
      arrLat: AIRPORT_DB.MUC.lat,
      arrLon: AIRPORT_DB.MUC.lon,
      departureTime: new Date('2024-04-10T08:00:00Z'),
      arrivalTime: new Date('2024-04-10T09:00:00Z'),
      depTimeSemantics: 'UTC',
      arrTimeSemantics: 'UTC',
      airline: 'Lufthansa',
      aircraft: null,
      status: 'flown',
      price: null,
      taxes: null,
      fees: null,
      category: null,
      seatClass: null,
      createdAt: new Date(),
      bookingId: null,
      booking: null,
    };

    // Flight B: FRA -> JFK, historical, 1989-03-15 12:00-20:00 UTC (480 min).
    const flightB = {
      ...flightA,
      id: 'b',
      arrIata: 'JFK',
      arrIcao: 'KJFK',
      arrLat: AIRPORT_DB.JFK.lat,
      arrLon: AIRPORT_DB.JFK.lon,
      departureTime: new Date('1989-03-15T12:00:00Z'),
      arrivalTime: new Date('1989-03-15T20:00:00Z'),
      status: 'historical',
    };

    // Every findMany call the route triggers (computeSummary's flownFlights
    // query, computeSummary's cost query, and the hero handler's own
    // airport+fun query) can resolve to the same superset row shape — each
    // consumer only reads the fields it needs and ignores the rest.
    mockFindMany.mockResolvedValue([flightA, flightB]);
    mockCount.mockResolvedValue(2);
    mockGroupBy.mockResolvedValue([]);

    const distA = calculateDistance(
      AIRPORT_DB.FRA.lat,
      AIRPORT_DB.FRA.lon,
      AIRPORT_DB.MUC.lat,
      AIRPORT_DB.MUC.lon,
    );
    const distB = calculateDistance(
      AIRPORT_DB.FRA.lat,
      AIRPORT_DB.FRA.lon,
      AIRPORT_DB.JFK.lat,
      AIRPORT_DB.JFK.lon,
    );
    const expectedDistanceKm = Math.round(distA + distB);

    const co2A = calculateCo2Kg({
      depLat: AIRPORT_DB.FRA.lat,
      depLon: AIRPORT_DB.FRA.lon,
      arrLat: AIRPORT_DB.MUC.lat,
      arrLon: AIRPORT_DB.MUC.lon,
      seatClass: toSeatClass(null),
    })!;
    const co2B = calculateCo2Kg({
      depLat: AIRPORT_DB.FRA.lat,
      depLon: AIRPORT_DB.FRA.lon,
      arrLat: AIRPORT_DB.JFK.lat,
      arrLon: AIRPORT_DB.JFK.lon,
      seatClass: toSeatClass(null),
    })!;
    const expectedCo2Kg = co2A + co2B;

    const res = await request(app).get('/api/v1/stats/hero');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      distanceKm: expectedDistanceKm,
      flights: 2,
      countries: 2, // DE, US
      airports: 3, // FRA, MUC, JFK
      co2Kg: expectedCo2Kg,
      flightTimeMinutes: 540, // 60 + 480, UTC semantics = naive diff
    });
  });
});

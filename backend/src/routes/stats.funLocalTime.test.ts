import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();
const mockGetCachedAirports = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: { findMany: mockFindMany },
    userSettings: { findUnique: jest.fn().mockResolvedValue(null) },
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

const AIRPORT_DB: Record<
  string,
  { lat: number; lon: number; country: string; timezone: string }
> = {
  FRA: { lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  MUC: { lat: 48.3538, lon: 11.7861, country: 'DE', timezone: 'Europe/Berlin' },
  JFK: { lat: 40.6398, lon: -73.7789, country: 'US', timezone: 'America/New_York' },
};

function flightRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a',
    depIata: 'FRA',
    depIcao: null,
    arrIata: 'MUC',
    arrIcao: null,
    depLat: AIRPORT_DB.FRA.lat,
    depLon: AIRPORT_DB.FRA.lon,
    arrLat: AIRPORT_DB.MUC.lat,
    arrLon: AIRPORT_DB.MUC.lon,
    departureTime: new Date('2026-07-01T05:00:00Z'),
    arrivalTime: new Date('2026-07-01T06:00:00Z'),
    depTimeSemantics: 'UTC',
    airline: 'Lufthansa',
    aircraft: null,
    status: 'flown',
    price: null,
    taxes: null,
    fees: null,
    category: null,
    seatClass: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Route-level cover for #266. The stats modules read the departure clock off
 * the flight row, and the ROUTE is what puts it there — so a unit test on the
 * calculators alone would still pass if the endpoint stopped resolving the
 * timezone or dropped `depTimeSemantics` from its select. These go through
 * the handler for that reason.
 */
describe('GET /api/v1/stats/fun — reads the clock at the departure airport', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFindMany.mockReset();
    mockGetCachedAirports.mockReset();
    mockGetCachedAirports.mockImplementation(async (...args: unknown[]) => {
      const codes = args[0] as string[];
      const map = new Map<string, unknown>();
      for (const code of codes) {
        const upper = code.toUpperCase();
        if (AIRPORT_DB[upper]) map.set(upper, AIRPORT_DB[upper]);
      }
      return map;
    });
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('counts a 07:00 Frankfurt departure as a morning flight', async () => {
    // 05:00 UTC. Read as UTC it is a night flight; on the clock at FRA it is
    // an ordinary 07:00 departure.
    mockFindMany.mockResolvedValue([flightRow({})]);

    const res = await request(app).get('/api/v1/stats/fun');

    expect(res.status).toBe(200);
    expect(res.body.earlyBird).toBe(1);
    expect(res.body.nightOwl).toBe(0);
  });

  it('files a 31 December New York departure under the year it was flown', async () => {
    // 22:30 on 31 December in New York is 03:30 on 1 January UTC.
    mockFindMany.mockResolvedValue([
      flightRow({
        depIata: 'JFK',
        depLat: AIRPORT_DB.JFK.lat,
        depLon: AIRPORT_DB.JFK.lon,
        departureTime: new Date('2026-01-01T03:30:00Z'),
        arrivalTime: new Date('2026-01-01T10:30:00Z'),
      }),
    ]);

    const res = await request(app).get('/api/v1/stats/fun');

    expect(res.status).toBe(200);
    expect(res.body.milestoneYear).toBe(2025);
    expect(res.body.fastestDay).toBe('2025-12-31');
  });
});

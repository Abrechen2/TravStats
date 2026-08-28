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

const AIRPORT_DB: Record<string, { country: string; timezone: string }> = {
  JFK: { country: 'US', timezone: 'America/New_York' },
  LHR: { country: 'GB', timezone: 'Europe/London' },
};

function flightRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    depIata: 'JFK',
    depIcao: null,
    arrIata: 'LHR',
    arrIcao: null,
    // 22:30 on 31 December in New York — already 1 January in UTC.
    departureTime: new Date('2026-01-01T03:30:00Z'),
    depTimeSemantics: 'UTC',
    ...overrides,
  };
}

describe('GET /api/v1/stats/countries — year index reads the departure clock', () => {
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

  it('files a 31 December New York departure under 2025', async () => {
    mockFindMany.mockResolvedValue([flightRow({})]);

    const res = await request(app).get('/api/v1/stats/countries');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.byYear)).toEqual(['2025']);
    expect(res.body.byYear['2025'].sort()).toEqual(['GB', 'US']);
  });

  it('does not convert a legacy fake-UTC row a second time', async () => {
    // A LEGACY_FAKE_UTC row stores the wall clock itself: these components
    // read 1 January 03:30 in New York. Converting them through the airport
    // timezone would subtract the offset again and move the flight into 2025.
    mockFindMany.mockResolvedValue([
      flightRow({ depTimeSemantics: 'LEGACY_FAKE_UTC' }),
    ]);

    const res = await request(app).get('/api/v1/stats/countries');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.byYear)).toEqual(['2026']);
  });
});

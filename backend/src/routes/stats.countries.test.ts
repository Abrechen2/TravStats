import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();
const mockGetCachedAirports = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: { findMany: mockFindMany },
  },
}));
jest.mock('../services/airportCache', () => ({
  getCachedAirports: mockGetCachedAirports,
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));
jest.mock('../middleware/rateLimit', () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';

describe('GET /api/v1/stats/countries', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('returns countries ranked by departure flight count', async () => {
    mockFindMany.mockResolvedValue([
      { depIata: 'FRA', depIcao: null },
      { depIata: 'MUC', depIcao: null },
      { depIata: 'LHR', depIcao: null },
      { depIata: null, depIcao: 'EDDF' },
    ]);
    mockGetCachedAirports.mockResolvedValue(new Map([
      ['FRA', { country: 'Germany' }],
      ['MUC', { country: 'Germany' }],
      ['LHR', { country: 'United Kingdom' }],
      ['EDDF', { country: 'Germany' }],
    ]));

    const res = await request(app).get('/api/v1/stats/countries');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);

    const de = res.body.countries.find((c: { country: string }) => c.country === 'Germany');
    const uk = res.body.countries.find((c: { country: string }) => c.country === 'United Kingdom');
    expect(de.count).toBe(3);
    expect(uk.count).toBe(1);
    // Sorted descending
    expect(res.body.countries[0].country).toBe('Germany');
  });
});

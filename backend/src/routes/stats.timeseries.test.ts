import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFlightFindMany = jest.fn();
const mockCruiseFindMany = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: { findMany: mockFlightFindMany },
    cruise: { findMany: mockCruiseFindMany },
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'u1';
    next();
  },
  AuthRequest: {},
}));
jest.mock('../services/airportCache', () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

import request from 'supertest';
import express from 'express';

describe('GET /api/v1/stats/timeseries', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFlightFindMany.mockReset();
    mockCruiseFindMany.mockReset();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('returns a zero-filled flight series with current and previous totals', async () => {
    // current window rows on first call, previous window rows on second call
    mockFlightFindMany
      .mockResolvedValueOnce([
        {
          depIata: 'FRA', depIcao: null, depLat: 50, depLon: 8,
          arrIata: 'JFK', arrIcao: null, arrLat: 40, arrLon: -73,
          departureTime: new Date('2025-03-10T00:00:00Z'), arrivalTime: null,
          depTimeSemantics: 'LOCAL', arrTimeSemantics: 'LOCAL',
        },
      ])
      .mockResolvedValueOnce([]); // previous window empty

    const res = await request(app).get(
      '/api/v1/stats/timeseries?domain=flight&granularity=month&fromDate=2025-01-01&toDate=2025-04-01',
    );

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe('flight');
    expect(res.body.series.map((p: { period: string }) => p.period)).toEqual([
      '2025-01', '2025-02', '2025-03',
    ]);
    const march = res.body.series.find((p: { period: string }) => p.period === '2025-03');
    expect(march.count).toBe(1);
    expect(march.distanceKm).toBeGreaterThan(0);
    expect(res.body.current.count).toBe(1);
    expect(res.body.previous.count).toBe(0);
  });

  it('returns 200 with an empty series for an account with no flights', async () => {
    mockFlightFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/stats/timeseries?window=year&year=2020');
    expect(res.status).toBe(200);
    expect(res.body.current).toEqual({ count: 0, distanceKm: 0, durationMin: 0 });
  });

  it('buckets cruises by start date when domain=cruise', async () => {
    mockCruiseFindMany
      .mockResolvedValueOnce([
        { startDate: new Date('2025-02-01T00:00:00Z'), legs: [{ distanceKm: 300 }, { distanceKm: 200 }] },
      ])
      .mockResolvedValueOnce([]);
    const res = await request(app).get(
      '/api/v1/stats/timeseries?domain=cruise&granularity=month&fromDate=2025-01-01&toDate=2025-03-01',
    );
    expect(res.status).toBe(200);
    const feb = res.body.series.find((p: { period: string }) => p.period === '2025-02');
    expect(feb.count).toBe(1);
    expect(feb.distanceKm).toBe(500);
  });

  it('trims the all-time series to the data range (no empty 1970 buckets)', async () => {
    mockFlightFindMany.mockResolvedValue([
      {
        depIata: 'FRA', depIcao: null, depLat: 50, depLon: 8,
        arrIata: 'JFK', arrIcao: null, arrLat: 40, arrLon: -73,
        departureTime: new Date('2024-06-10T00:00:00Z'), arrivalTime: null,
        depTimeSemantics: 'LOCAL', arrTimeSemantics: 'LOCAL',
      },
    ]);
    const res = await request(app).get('/api/v1/stats/timeseries?window=all&granularity=year');
    expect(res.status).toBe(200);
    // Without trimming this would span 1970..current; trimmed it is just the data year.
    expect(res.body.series.map((p: { period: string }) => p.period)).toEqual(['2024']);
    expect(res.body.current.count).toBe(1);
  });

  it('rejects an invalid domain', async () => {
    const res = await request(app).get('/api/v1/stats/timeseries?domain=hotel');
    expect(res.status).toBe(400);
  });
});

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

  // The overview's "countries visited" tile showed the LIFETIME set for every
  // selected year and rendered an always-zero delta on top of it. byYear is
  // the year-scoped index that replaced that approximation.
  describe('byYear', () => {
    it('buckets each departure country under the departure airport\'s local year', () => {
      // Deliberately not the browser's year and not UTC: the traveller's
      // year is the one on the clock at the airport they departed from.
      mockFindMany.mockResolvedValue([
        {
          depIata: 'FRA',
          depIcao: null,
          departureTime: new Date('2024-03-05T08:00:00.000Z'),
        },
        {
          depIata: 'LHR',
          depIcao: null,
          departureTime: new Date('2026-07-02T09:00:00.000Z'),
        },
      ]);
      mockGetCachedAirports.mockResolvedValue(new Map([
        ['FRA', { country: 'Germany', timezone: 'Europe/Berlin' }],
        ['LHR', { country: 'United Kingdom', timezone: 'Europe/London' }],
      ]));

      return request(app)
        .get('/api/v1/stats/countries')
        .then((res) => {
          expect(res.status).toBe(200);
          expect(res.body.byYear['2024']).toEqual(['DE']);
          expect(res.body.byYear['2026']).toEqual(['GB']);
        });
    });

    it('uses the departure timezone, so a late-night flight stays in its own local year', async () => {
      // 2025-12-31 22:30 in New York is already 2026-01-01 03:30 UTC. Bucketing
      // on the UTC instant would file this trip under the wrong year.
      mockFindMany.mockResolvedValue([
        {
          depIata: 'JFK',
          depIcao: null,
          departureTime: new Date('2026-01-01T03:30:00.000Z'),
        },
      ]);
      mockGetCachedAirports.mockResolvedValue(new Map([['JFK', { country: 'United States', timezone: 'America/New_York' }]]));

      const res = await request(app).get('/api/v1/stats/countries');
      expect(res.body.byYear['2025']).toEqual(['US']);
      expect(res.body.byYear['2026']).toBeUndefined();
    });

    it('leaves a flight without a departure time out of every year bucket but keeps it in the lifetime list', async () => {
      mockFindMany.mockResolvedValue([
        { depIata: 'FRA', depIcao: null, departureTime: null },
      ]);
      mockGetCachedAirports.mockResolvedValue(new Map([['FRA', { country: 'Germany', timezone: 'Europe/Berlin' }]]));

      const res = await request(app).get('/api/v1/stats/countries');
      expect(res.body.countries).toEqual([{ country: 'Germany', count: 1 }]);
      expect(res.body.countriesIso).toEqual(['DE']);
      expect(res.body.byYear).toEqual({});
    });

    it('reports the counting vocabulary as ISO codes and drops what cannot be resolved', () => {
      // "Unknown" is what an unmatched airport resolves to. It cannot be
      // deduplicated against the port catalogue, so it must not be counted as
      // a country — that is how the tile ended up inflated in the first place.
      mockFindMany.mockResolvedValue([
        {
          depIata: 'FRA',
          depIcao: null,
          departureTime: new Date('2026-02-01T08:00:00.000Z'),
        },
        { depIata: null, depIcao: null, departureTime: new Date('2026-03-01T08:00:00.000Z') },
      ]);
      mockGetCachedAirports.mockResolvedValue(new Map([
        ['FRA', { country: 'Germany', timezone: 'Europe/Berlin' }],
      ]));

      return request(app)
        .get('/api/v1/stats/countries')
        .then((res) => {
          // Display list keeps Unknown — the distribution card shows it.
          expect(res.body.countries.map((c: { country: string }) => c.country)).toContain(
            'Unknown',
          );
          expect(res.body.countriesIso).toEqual(['DE']);
          expect(res.body.byYear['2026']).toEqual(['DE']);
        });
    });

    it('deduplicates a country within a year and sorts the list', async () => {
      mockFindMany.mockResolvedValue([
        {
          depIata: 'FRA',
          depIcao: null,
          departureTime: new Date('2026-02-01T08:00:00.000Z'),
        },
        {
          depIata: 'MUC',
          depIcao: null,
          departureTime: new Date('2026-05-01T08:00:00.000Z'),
        },
        {
          depIata: 'LHR',
          depIcao: null,
          departureTime: new Date('2026-06-01T08:00:00.000Z'),
        },
      ]);
      mockGetCachedAirports.mockResolvedValue(new Map([
        ['FRA', { country: 'Germany', timezone: 'Europe/Berlin' }],
        ['MUC', { country: 'Germany', timezone: 'Europe/Berlin' }],
        ['LHR', { country: 'United Kingdom', timezone: 'Europe/London' }],
      ]));

      const res = await request(app).get('/api/v1/stats/countries');
      expect(res.body.byYear['2026']).toEqual(['DE', 'GB']);
    });
  });
});

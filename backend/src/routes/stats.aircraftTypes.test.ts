import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGroupBy = jest.fn();
const mockCount = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: {
      groupBy: mockGroupBy,
      count: mockCount,
    },
  },
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

describe('GET /api/v1/stats/aircraft-types', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('ranks aircraft types by flight count with percentages', async () => {
    mockCount.mockResolvedValue(10);
    mockGroupBy.mockResolvedValue([
      { aircraft: 'Airbus A320neo', _count: 6 },
      { aircraft: 'Boeing 747-8', _count: 2 },
    ]);

    const res = await request(app).get('/api/v1/stats/aircraft-types');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.aircraftTypes).toEqual([
      { aircraft: 'Airbus A320neo', count: 6, percentage: 60 },
      { aircraft: 'Boeing 747-8', count: 2, percentage: 20 },
    ]);
  });

  it('sorts by count descending regardless of query order', async () => {
    mockCount.mockResolvedValue(3);
    mockGroupBy.mockResolvedValue([
      { aircraft: 'Boeing 737', _count: 1 },
      { aircraft: 'Airbus A350', _count: 2 },
    ]);

    const res = await request(app).get('/api/v1/stats/aircraft-types');
    expect(res.status).toBe(200);
    expect(
      res.body.aircraftTypes.map((r: { aircraft: string }) => r.aircraft),
    ).toEqual(['Airbus A350', 'Boeing 737']);
  });

  it('returns an empty ranking for a user with no typed flights', async () => {
    mockCount.mockResolvedValue(0);
    mockGroupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/stats/aircraft-types');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aircraftTypes: [], total: 0 });
  });
});

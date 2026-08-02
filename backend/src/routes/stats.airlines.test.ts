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

describe('GET /api/v1/stats/airlines', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('returns airlines ranked by flight count with percentages', async () => {
    mockCount.mockResolvedValue(10);
    mockGroupBy.mockResolvedValue([
      { airline: 'Lufthansa', _count: 6 },
      { airline: 'Ryanair', _count: 4 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.airlines).toHaveLength(2);
    expect(res.body.airlines[0]).toEqual({
      airline: 'Lufthansa',
      count: 6,
      percentage: 60.0,
      iata: 'LH',
    });
    expect(res.body.airlines[1]).toEqual({
      airline: 'Ryanair',
      count: 4,
      percentage: 40.0,
      iata: 'FR',
    });
  });

  it('handles null airline as Unknown', async () => {
    mockCount.mockResolvedValue(2);
    mockGroupBy.mockResolvedValue([
      { airline: null, _count: 2 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines[0].airline).toBe('Unknown');
  });

  it('carries the resolved IATA code when the catalogue knows the airline', async () => {
    mockCount.mockResolvedValue(1);
    mockGroupBy.mockResolvedValue([
      { airline: 'Lufthansa', _count: 1 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines[0].iata).toBe('LH');
  });

  it('omits iata when the airline cannot be resolved', async () => {
    mockCount.mockResolvedValue(1);
    mockGroupBy.mockResolvedValue([
      { airline: 'Definitely Not An Airline', _count: 1 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines[0].iata).toBeUndefined();
  });
});

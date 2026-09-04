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

  // forgejo#81 — identity is the code, not the spelling. Four surfaces once
  // counted 31/27/26/25 airlines for one account because "SWISS" and "Swiss"
  // were two names and "LOT" and "LOT - Polish Airlines" two more.
  it('returns one row for two spellings that share an airline code, named by the catalogue', async () => {
    mockCount.mockResolvedValue(10);
    mockGroupBy.mockResolvedValue([
      { airline: 'Swiss', airlineIata: 'LX', airlineIcao: null, _count: 3 },
      { airline: 'SWISS', airlineIata: null, airlineIcao: 'SWR', _count: 2 },
      { airline: 'Swiss International Air Lines', airlineIata: null, airlineIcao: null, _count: 1 },
      { airline: 'LOT - Polish Airlines', airlineIata: null, airlineIcao: null, _count: 2 },
      { airline: 'LOT', airlineIata: null, airlineIcao: null, _count: 2 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines).toHaveLength(2);
    expect(res.body.airlines[0]).toMatchObject({ iata: 'LX', count: 6, percentage: 60.0 });
    expect(res.body.airlines[1]).toMatchObject({ iata: 'LO', count: 4, percentage: 40.0 });
  });

  // The page shows this ranking a few hundred pixels below the client-side
  // breakdown, which keeps only flown + historical. Counting every status here
  // made the same airline read 16 in one card and 14 in the other.
  it('counts only flown and historical flights, like every other stats aggregate', async () => {
    mockCount.mockResolvedValue(3);
    mockGroupBy.mockResolvedValue([{ airline: 'Lufthansa', _count: 3 }]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);

    const flownAndHistorical = { in: ['flown', 'historical'] };
    expect(mockCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: flownAndHistorical }),
    });
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: flownAndHistorical }),
      }),
    );
  });

  it('does not rank a missing airline as one', async () => {
    // A flight without an airline used to be folded in under the label
    // "Unknown", which could top the loyalty ranking on an account full of
    // imported rows — and it sat in the percentage denominator, diluting
    // every real airline's share. It is reported beside the ranking instead.
    mockCount.mockResolvedValue(3);
    mockGroupBy.mockResolvedValue([
      { airline: null, _count: 2 },
      { airline: 'Lufthansa', _count: 1 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines.map((a: { airline: string }) => a.airline)).toEqual(['Lufthansa']);
    expect(res.body.flightsWithoutAirline).toBe(2);
    // The one attributed flight is 100 % of what can be attributed, not 33 %.
    expect(res.body.airlines[0].percentage).toBe(100);
    expect(res.body.total).toBe(1);
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

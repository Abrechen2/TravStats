import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: {
      findMany: mockFindMany,
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

describe('GET /api/v1/stats/aircraft', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFindMany.mockReset();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  // A cancelled flight never happened, so it must not add its distance to a
  // hull's lifetime total — the same status scope the rest of /stats uses.
  it('counts only flown and historical flights', async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/stats/aircraft');
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['flown', 'historical'] } }),
      }),
    );
  });
});

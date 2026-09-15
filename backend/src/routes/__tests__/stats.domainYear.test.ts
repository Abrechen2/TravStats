import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCruiseFindMany = jest.fn();
const mockStayFindMany = jest.fn();
const mockLodgingFindMany = jest.fn();
const mockUserFindUnique = jest.fn();
const mockSettingsFindUnique = jest.fn();
const mockMembershipFindMany = jest.fn();

jest.mock('../../db', () => ({
  prisma: {
    cruise: { findMany: mockCruiseFindMany },
    lodgingStay: { findMany: mockStayFindMany },
    lodging: { findMany: mockLodgingFindMany },
    user: { findUnique: mockUserFindUnique },
    userSettings: { findUnique: mockSettingsFindUnique },
    lodgingMembership: { findMany: mockMembershipFindMany },
  },
}));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'u1';
    next();
  },
  AuthRequest: {},
}));
jest.mock('../../middleware/rateLimit', () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';

/**
 * `?year=` on the two domain rollups.
 *
 * The defect these exist for was not a wrong number — it was two right
 * numbers that contradict each other. The cross-domain overview filters by
 * year; the cruise and lodging tabs filtered by nothing, so the overview said
 * "no stays in 2026" while the tab next to it showed a lifetime total. Both
 * were true, and a reader can only conclude that one of them is broken.
 *
 * What is pinned here is the CONTRACT, not the arithmetic: which rows the
 * year asks for. The arithmetic belongs to `calculateCruiseStats` and
 * `calculateLodgingStats` and has its own tests.
 */
describe('domain stats honour ?year=', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    // Call history too, not just the resolved values: `mockResolvedValue`
    // leaves the recorded calls in place, so the "no year" test read the
    // previous test's `where` and reported the 2024 window as if the endpoint
    // had asked for it.
    jest.clearAllMocks();
    mockCruiseFindMany.mockResolvedValue([]);
    mockStayFindMany.mockResolvedValue([]);
    mockLodgingFindMany.mockResolvedValue([]);
    mockUserFindUnique.mockResolvedValue({ birthdate: null });
    mockSettingsFindUnique.mockResolvedValue({ baseCurrency: 'EUR' });
    mockMembershipFindMany.mockResolvedValue([]);
    const { default: statsRoutes } = await import('../stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('asks for cruises that STARTED in the year, as a half-open window', async () => {
    await request(app).get('/api/v1/stats/cruise?year=2024').expect(200);

    const where = mockCruiseFindMany.mock.calls[0]?.[0]?.where;
    expect(where.startDate).toEqual({
      gte: new Date(Date.UTC(2024, 0, 1)),
      lt: new Date(Date.UTC(2025, 0, 1)),
    });
  });

  it('asks for every cruise when no year is given', async () => {
    await request(app).get('/api/v1/stats/cruise').expect(200);
    expect(mockCruiseFindMany.mock.calls[0]?.[0]?.where.startDate).toBeUndefined();
  });

  it('dates a stay by its check-in, so a New Year stay belongs to the year it began', async () => {
    await request(app).get('/api/v1/stats/lodging?year=2024').expect(200);

    const where = mockStayFindMany.mock.calls[0]?.[0]?.where;
    expect(where.checkIn).toEqual({
      gte: new Date(Date.UTC(2024, 0, 1)),
      lt: new Date(Date.UTC(2025, 0, 1)),
    });
  });

  it('counts only the houses that year was spent in, not every house on file', async () => {
    // Two houses exist; one stay, at the first. A bookmarked house has no date
    // at all, so it belongs to the lifetime view and to no year.
    mockLodgingFindMany.mockResolvedValue([
      { id: 'h1', chainId: null, type: 'hotel', country: 'DE', isoCountryCode: 'DE', city: 'Köln', visited: true },
      { id: 'h2', chainId: null, type: 'hotel', country: 'DE', isoCountryCode: 'DE', city: 'Bonn', visited: false },
    ]);
    mockStayFindMany.mockResolvedValue([
      {
        id: 's1',
        lodgingId: 'h1',
        checkIn: new Date('2024-03-01'),
        checkOut: new Date('2024-03-03'),
        price: null,
        currency: null,
        priceBase: null,
        baseCurrency: null,
        overallRating: null,
        roomRating: null,
        breakfastRating: null,
        serviceRating: null,
        board: null,
        roomType: null,
        lodging: { id: 'h1', chainId: null, type: 'hotel', country: 'DE', isoCountryCode: 'DE', city: 'Köln', visited: true, chain: null },
      },
    ]);

    const res = await request(app).get('/api/v1/stats/lodging?year=2024').expect(200);
    expect(res.body.data.lodgingsCount).toBe(1);
  });

  it('refuses a year that is not one', async () => {
    await request(app).get('/api/v1/stats/cruise?year=neunzehn').expect(400);
    await request(app).get('/api/v1/stats/lodging?year=12').expect(400);
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockAchievementFindMany = jest.fn();
const mockUserAchievementFindMany = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    achievement: { findMany: mockAchievementFindMany },
    userAchievement: { findMany: mockUserAchievementFindMany },
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireWriteScope: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));
jest.mock('../utils/achievements', () => ({
  checkAndUpdateAchievements: jest.fn(),
}));

import request from 'supertest';
import express from 'express';

// FIRST_FLIGHT is a live definition. FOUR_SEASONS_YEAR was removed from the
// seeds but stays in older databases on purpose, so existing unlocks survive.
function row(id: string, code: string, points = 10) {
  return {
    id,
    code,
    name: code,
    description: '',
    category: 'milestone',
    tier: 'bronze',
    requirement: 1,
    points,
  };
}

const ACTIVE = row('a1', 'FIRST_FLIGHT');
const ORPHAN = row('o1', 'FOUR_SEASONS_YEAR', 50);

describe('GET /api/v1/achievements — orphaned catalogue rows', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: achievementRoutes } = await import('./achievements');
    app = express();
    app.use(express.json());
    app.use('/api/v1/achievements', achievementRoutes);
  });

  it('does not count a removed definition in the total a user can reach', async () => {
    mockAchievementFindMany.mockResolvedValue([ACTIVE, ORPHAN]);
    mockUserAchievementFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/achievements');

    expect(res.status).toBe(200);
    expect(res.body.summary.totalAchievements).toBe(1);
    expect(res.body.summary.categories.milestone).toEqual({ total: 1, unlocked: 0 });
    expect(res.body.achievements.map((a: { code: string }) => a.code)).toEqual(['FIRST_FLIGHT']);
  });

  it('keeps a legacy unlock visible with its points, outside the fraction', async () => {
    mockAchievementFindMany.mockResolvedValue([ACTIVE, ORPHAN]);
    mockUserAchievementFindMany.mockResolvedValue([
      { achievementId: 'a1', progress: 1, unlockedAt: new Date(), achievement: ACTIVE },
      { achievementId: 'o1', progress: 1, unlockedAt: new Date(), achievement: ORPHAN },
    ]);

    const res = await request(app).get('/api/v1/achievements');

    expect(res.status).toBe(200);
    // 1 of 1, never 2 of 1.
    expect(res.body.summary.totalAchievements).toBe(1);
    expect(res.body.summary.unlockedAchievements).toBe(1);
    expect(res.body.summary.categories.milestone).toEqual({ total: 1, unlocked: 1 });
    // The badge and its points were earned and are not taken away.
    expect(res.body.summary.totalPoints).toBe(60);
    expect(res.body.achievements.map((a: { code: string }) => a.code).sort()).toEqual([
      'FIRST_FLIGHT',
      'FOUR_SEASONS_YEAR',
    ]);
  });
});

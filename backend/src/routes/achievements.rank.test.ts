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

/** One catalogue row plus the user's progress against it. */
function achievement(id: string, points: number, requirement = 1) {
  return {
    id,
    code: `A_${id}`,
    name: id,
    description: '',
    category: 'milestone',
    tier: 'bronze',
    requirement,
    points,
  };
}

describe('GET /api/v1/achievements — rank in the summary', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: achievementRoutes } = await import('./achievements');
    app = express();
    app.use(express.json());
    app.use('/api/v1/achievements', achievementRoutes);
  });

  it('reports the first rung and the next threshold for a user with no points', async () => {
    mockAchievementFindMany.mockResolvedValue([achievement('a1', 100)]);
    mockUserAchievementFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/achievements');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalPoints: 0,
      rank: 'newcomer',
      nextRankPoints: 1000,
    });
  });

  it('derives the rank from unlocked points only', async () => {
    const unlocked = achievement('a1', 4755);
    const locked = achievement('a2', 9000);
    mockAchievementFindMany.mockResolvedValue([unlocked, locked]);
    mockUserAchievementFindMany.mockResolvedValue([
      { achievementId: 'a1', progress: 1, achievement: unlocked },
      // in progress, not unlocked — its points must not count toward the rank
      { achievementId: 'a2', progress: 0, achievement: locked },
    ]);

    const res = await request(app).get('/api/v1/achievements');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalPoints: 4755,
      rank: 'frequent_flyer',
      nextRankPoints: 5000,
    });
  });

  it('sends a null next threshold once the top rung is reached', async () => {
    const top = achievement('a1', 12_000);
    mockAchievementFindMany.mockResolvedValue([top]);
    mockUserAchievementFindMany.mockResolvedValue([
      { achievementId: 'a1', progress: 1, achievement: top },
    ]);

    const res = await request(app).get('/api/v1/achievements');
    expect(res.status).toBe(200);
    expect(res.body.summary.rank).toBe('legend');
    expect(res.body.summary.nextRankPoints).toBeNull();
  });

  it('leaves the existing summary fields untouched', async () => {
    const a1 = achievement('a1', 100);
    mockAchievementFindMany.mockResolvedValue([a1, achievement('a2', 50)]);
    mockUserAchievementFindMany.mockResolvedValue([
      { achievementId: 'a1', progress: 1, achievement: a1 },
    ]);

    const res = await request(app).get('/api/v1/achievements');
    expect(res.body.summary).toMatchObject({
      totalAchievements: 2,
      unlockedAchievements: 1,
      totalPoints: 100,
      categories: { milestone: { total: 2, unlocked: 1 } },
    });
  });
});

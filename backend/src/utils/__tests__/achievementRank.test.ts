import { RANK_LADDER, resolveRank } from '../achievementRank';

describe('resolveRank', () => {
  it('places a new user on the first rung with the next threshold ahead', () => {
    expect(resolveRank(0)).toEqual({ rank: 'newcomer', nextRankPoints: 1000 });
  });

  it('keeps a user on a rung until the next threshold is reached', () => {
    expect(resolveRank(999)).toEqual({ rank: 'newcomer', nextRankPoints: 1000 });
    expect(resolveRank(1000)).toEqual({
      rank: 'traveller',
      nextRankPoints: 2500,
    });
  });

  it('resolves a mid-ladder score to its rung and the following threshold', () => {
    expect(resolveRank(4755)).toEqual({
      rank: 'frequent_flyer',
      nextRankPoints: 5000,
    });
  });

  it('reports no next threshold at the top rung', () => {
    expect(resolveRank(10_000)).toEqual({
      rank: 'legend',
      nextRankPoints: null,
    });
    expect(resolveRank(999_999)).toEqual({
      rank: 'legend',
      nextRankPoints: null,
    });
  });

  it('treats a negative or non-finite score as the first rung', () => {
    expect(resolveRank(-5).rank).toBe('newcomer');
    expect(resolveRank(Number.NaN).rank).toBe('newcomer');
  });

  it('exposes a ladder that ascends and starts at zero', () => {
    expect(RANK_LADDER[0].minPoints).toBe(0);
    const thresholds = RANK_LADDER.map((tier) => tier.minPoints);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
    expect(new Set(RANK_LADDER.map((t) => t.key)).size).toBe(RANK_LADDER.length);
  });
});

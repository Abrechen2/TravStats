/**
 * Achievement rank ladder — a pure points→rung mapping over the achievement
 * points a user has actually unlocked.
 *
 * `key` is a stable slug, never a display string: every client (web UI and the
 * Companion app) localizes it itself, so adding a locale never needs a server
 * change. Thresholds are deliberately coarse — this is a progress flourish on
 * the achievements summary, not a scoring system.
 */

export interface RankTier {
  /** Stable slug; clients map this to localized copy. */
  key: string;
  /** Inclusive lower bound in achievement points. */
  minPoints: number;
}

export const RANK_LADDER: readonly RankTier[] = [
  { key: 'newcomer', minPoints: 0 },
  { key: 'traveller', minPoints: 1_000 },
  { key: 'explorer', minPoints: 2_500 },
  { key: 'frequent_flyer', minPoints: 4_000 },
  { key: 'globetrotter', minPoints: 5_000 },
  { key: 'legend', minPoints: 10_000 },
];

export interface ResolvedRank {
  rank: string;
  /** Points opening the next rung, or null at the top of the ladder. */
  nextRankPoints: number | null;
}

/** The rung a points total sits on, plus the threshold that opens the next. */
export function resolveRank(points: number): ResolvedRank {
  const score = Number.isFinite(points) && points > 0 ? points : 0;

  let index = 0;
  for (let i = 0; i < RANK_LADDER.length; i += 1) {
    if (score >= RANK_LADDER[i].minPoints) {
      index = i;
    }
  }

  const next = RANK_LADDER[index + 1];
  return {
    rank: RANK_LADDER[index].key,
    nextRankPoints: next ? next.minPoints : null,
  };
}

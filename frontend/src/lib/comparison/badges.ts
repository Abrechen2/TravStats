/**
 * Playful badges per participant, earned from signed totals alone. A total that is null (not
 * shared, not derivable) earns nothing and is not "missing a badge" either: `evaluateBadges`
 * returns only the ones held, and `null` for a row with no snapshot at all.
 */
import type { LeaderboardRow } from "./types";

export interface BadgeDef {
  code:
    "globetrotter" | "frequentFlyer" | "railFriend" | "seafarer" | "homeAway" | "heritageHunter";
  metric: string;
  /** At least this much earns it. */
  threshold: number;
  /** Emoji shown beside the DE/EN name (copy lives in `badges.<code>`). */
  glyph: string;
}

export const BADGES: readonly BadgeDef[] = [
  { code: "globetrotter", metric: "countries", threshold: 30, glyph: "🌍" },
  { code: "frequentFlyer", metric: "flights", threshold: 100, glyph: "✈️" },
  { code: "railFriend", metric: "railKm", threshold: 10_000, glyph: "🚆" },
  { code: "seafarer", metric: "cruiseKm", threshold: 20_000, glyph: "⚓" },
  { code: "homeAway", metric: "nights", threshold: 365, glyph: "🛏️" },
  { code: "heritageHunter", metric: "curatedWorldHeritage", threshold: 25, glyph: "🏛️" },
];

export function evaluateBadges(
  row: LeaderboardRow | undefined,
  year: number | null
): BadgeDef[] | null {
  if (!row || row.status !== "ok" || !row.snapshot || row.snapshot.year !== year) return null;
  const metrics = row.snapshot.metrics;
  return BADGES.filter((b) => {
    const v = metrics[b.metric];
    return typeof v === "number" && v >= b.threshold;
  });
}

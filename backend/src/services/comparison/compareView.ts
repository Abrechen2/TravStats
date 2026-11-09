/**
 * The Freunde page's comparison (spec 2026-11-07 §6.5): the reader plus the few friends picked,
 * built by the leaderboard reader narrowed to exactly those keys — so a pick of two never pulls
 * the other eighteen remote servers. A key that is no longer a visible friend (they stopped
 * sharing back, or ended it) is simply not a row; the page reads the absence as "withdrawn".
 */
import type { CompareResponse } from "../../schemas/comparison";
import { readLeaderboard } from "./leaderboard";

export async function readCompare(
  viewerId: string,
  query: { year: number | null; friends: readonly string[] }
): Promise<CompareResponse> {
  const board = await readLeaderboard(viewerId, {
    year: query.year,
    keys: new Set(query.friends),
  });
  const self = board.rows.find((r) => r.person.kind === "self");
  if (!self) throw new Error("The leaderboard has no row for its own reader");
  const byKey = new Map(board.rows.map((r) => [r.person.key, r] as const));
  const friends = query.friends.flatMap((k) => {
    const row = byKey.get(k);
    return row ? [row] : [];
  });
  return { year: board.year, self, friends };
}

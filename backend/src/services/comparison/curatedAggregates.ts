/**
 * The curated-list family of the leaderboard: per standard checklist, how many of its targets
 * a person has been to, and how big the list is. Two integers per list — never which targets.
 * A list's size comes from the catalogue the sender runs, so the receiver draws "23 / 1199"
 * against the sender's own list rather than guessing at its version.
 */
import { prisma } from "../../db";
import { classifyPlace } from "../../shared/placeCounting";
import { CURATED_LIST_METRICS, curatedSizeKey } from "../../shared/comparisonMetrics";

export type CuratedFigures = Record<string, number | null>;

/** Ids are namespaced "listKey:slug" (routes/placeLists/curated.ts): the prefix is the list. */
const listOf = (curatedItemId: string): string => curatedItemId.split(":")[0];

/**
 * `<metric>` = visited targets, `<metric>Of` = list size. Lifetime only: a checklist has no year,
 * so a year view is null for both rather than a lifetime figure under a year's name. A list the
 * catalogue does not carry (not seeded here) is null too, never 0 of 0.
 */
export async function loadCuratedFigures(
  userId: string,
  year: number | null,
  keys: ReadonlySet<string>
): Promise<CuratedFigures> {
  const wanted = CURATED_LIST_METRICS.filter((m) => keys.has(m.key));
  const out: CuratedFigures = {};
  if (wanted.length === 0) return out;
  if (year !== null) {
    for (const m of wanted) {
      out[m.key] = null;
      out[curatedSizeKey(m.key)] = null;
    }
    return out;
  }
  const lists = await prisma.curatedList.findMany({
    where: { key: { in: wanted.map((m) => m.curatedList) } },
    select: { key: true, _count: { select: { items: true } } },
  });
  const sizes = new Map(lists.map((l) => [l.key, l._count.items]));
  const places = await prisma.place.findMany({
    where: { userId, curatedItemId: { not: null }, visited: true },
    select: { curatedItemId: true, visited: true },
  });
  const visited = new Map<string, number>();
  for (const p of places) {
    if (p.curatedItemId === null || classifyPlace(p) !== "visited") continue;
    const list = listOf(p.curatedItemId);
    visited.set(list, (visited.get(list) ?? 0) + 1);
  }
  for (const m of wanted) {
    const size = sizes.get(m.curatedList);
    if (size === undefined) {
      out[m.key] = null;
      out[curatedSizeKey(m.key)] = null;
      continue;
    }
    // A target removed from the catalogue since the tick must not push the count past the list.
    out[m.key] = Math.min(visited.get(m.curatedList) ?? 0, size);
    out[curatedSizeKey(m.key)] = size;
  }
  return out;
}

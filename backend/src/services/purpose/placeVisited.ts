import { classifyVisit } from "../../shared/placeCounting";
import { isHiddenByPurpose } from "../../shared/purpose";

/**
 * `Place.visited` is a STORED flag, switched on when a visit that has happened is written. A
 * business visit that the account hides is out of every count (owner rule), so a place that is
 * "visited" only through such a visit — what is left visible is a plan — must not count as been to.
 * A flag cannot be narrowed in a `where`, so the read hook corrects it on the way out.
 *
 * Demoted only when ALL hold: the stored flag is on, a visit that has happened is hidden, and no
 * visible visit has happened. A place with no visible visit at all is dropped by the parent rule
 * before it gets here, and a place the user marked visited with no visit behind it is left alone.
 */

export interface VisitFact {
  placeId: string;
  purpose: string | null;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
}

/** Reads every visit of these places, unfiltered; injected by `db.ts`. */
export type VisitLoader = (placeIds: string[]) => Promise<VisitFact[]>;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

const PLACE_READS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow"]);

/** Is this a read whose rows this module may correct? */
export const isPlaceRead = (model: string | undefined, operation: string): boolean =>
  model === "Place" && PLACE_READS.has(operation);

/** The place ids (of the rows that say `visited`) whose flag no longer stands. */
export function demotedPlaceIds(
  visits: readonly VisitFact[],
  hidden: readonly string[],
  now: Date
): Set<string> {
  const byPlace = new Map<string, { hiddenDone: boolean; visibleDone: boolean }>();
  for (const v of visits) {
    const entry = byPlace.get(v.placeId) ?? { hiddenDone: false, visibleDone: false };
    const done = classifyVisit({ visitedAt: v.visitedAt, visitedAtUtc: v.visitedAtUtc }, now) === "visited";
    if (done) {
      if (isHiddenByPurpose(v.purpose, hidden)) entry.hiddenDone = true;
      else entry.visibleDone = true;
    }
    byPlace.set(v.placeId, entry);
  }
  return new Set([...byPlace].filter(([, e]) => e.hiddenDone && !e.visibleDone).map(([id]) => id));
}

/**
 * Adds `id` to a `select` that asks for `visited` without it, so the rows can be matched; the
 * caller strips it again. Returns the (possibly new) args and whether it added the field.
 */
export function ensureIdSelected<A>(args: A): { args: A; added: boolean } {
  if (!isRow(args) || !isRow(args.select)) return { args, added: false };
  if (!args.select.visited || args.select.id) return { args, added: false };
  return { args: { ...args, select: { ...args.select, id: true } }, added: true };
}

/** Corrects `visited` on the rows a Place read returned. */
export async function demoteHiddenOnlyVisited<R>(
  result: R,
  hiddenPurposes: readonly string[],
  load: VisitLoader,
  stripId: boolean,
  now: Date
): Promise<R> {
  const rows = (Array.isArray(result) ? result : [result]).filter(isRow);
  const candidates = rows.filter((r) => r.visited === true && typeof r.id === "string");
  let demoted = new Set<string>();
  if (candidates.length > 0) {
    const visits = await load(candidates.map((r) => r.id as string));
    demoted = demotedPlaceIds(visits, hiddenPurposes, now);
  }
  const fix = (row: Row): Row => {
    const next = demoted.has(row.id as string) ? { ...row, visited: false } : { ...row };
    if (stripId) delete next.id;
    return next;
  };
  if (Array.isArray(result)) return result.map((r) => (isRow(r) ? fix(r) : r)) as R;
  return (isRow(result) ? fix(result) : result) as R;
}

/**
 * Which legs a route section should have, given the order of its stops.
 *
 * Pure and DB-free so the rule can be tested without a database, and so the
 * frontend can preview a reorder before saving it.
 *
 * Legs are identified by their ENDPOINT PAIR, never by position. That is
 * what lets a stop be inserted without disturbing the hand-drawn geometry
 * of every leg after it — the same reasoning `CruiseLegRoute` records.
 *
 * A pair that occurs twice in one section (an out-and-back) yields ONE leg:
 * the storage key is `(routeId, fromStopId, toStopId)`, so a second row for
 * the same pair could not be written. Both occurrences therefore render the
 * same line, which is almost always what the user meant.
 */

export interface ExistingLeg {
  id: string;
  fromStopId: string;
  toStopId: string;
}

export interface LegPair {
  fromStopId: string;
  toStopId: string;
}

export interface LegPlan {
  /** Rows to leave exactly as they are, geometry included. */
  keep: ExistingLeg[];
  /** Pairs with no row yet. */
  create: LegPair[];
  /** Ids of rows whose pair no longer occurs. */
  deleteIds: string[];
}

const keyOf = (from: string, to: string): string => `${from}\u0000${to}`;

export function planLegs(
  orderedStopIds: readonly string[],
  existing: readonly ExistingLeg[],
): LegPlan {
  const wanted = new Map<string, LegPair>();
  for (let i = 1; i < orderedStopIds.length; i++) {
    const from = orderedStopIds[i - 1];
    const to = orderedStopIds[i];
    const k = keyOf(from, to);
    if (!wanted.has(k)) wanted.set(k, { fromStopId: from, toStopId: to });
  }

  const keep: ExistingLeg[] = [];
  const deleteIds: string[] = [];
  const covered = new Set<string>();

  for (const leg of existing) {
    const k = keyOf(leg.fromStopId, leg.toStopId);
    if (wanted.has(k) && !covered.has(k)) {
      keep.push(leg);
      covered.add(k);
    } else {
      deleteIds.push(leg.id);
    }
  }

  const create: LegPair[] = [];
  for (const [k, pair] of wanted) {
    if (!covered.has(k)) create.push(pair);
  }

  return { keep, create, deleteIds };
}

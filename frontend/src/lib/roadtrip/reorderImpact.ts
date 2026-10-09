import { stationWarnings, type StationDraft } from "./roadtripView";
import type { LegSource, TourLeg } from "../../types/tour";

/**
 * What moving one station does, worked out BEFORE it is done (forgejo#242).
 *
 * The server keys legs by their two end stations: a pair that stays adjacent
 * keeps its leg, line and all; a pair that stops being adjacent loses its leg;
 * a new pair starts as a straight line (`recomputeLegs`). A reorder therefore
 * deletes every leg on either side of the moved station — and with it a line
 * someone drew by hand or took from a recording. That used to happen on the
 * press of an arrow, with nothing on screen saying so.
 */

export interface ReorderStation extends StationDraft {
  key: string;
}

export interface LegChange {
  from: ReorderStation;
  to: ReorderStation;
  /** The stored leg that goes; null for a pair that never had one saved. */
  leg: TourLeg | null;
}

export interface ReorderImpact {
  moved: ReorderStation;
  /** Its neighbours in the NEW order (null at either end). */
  before: ReorderStation | null;
  after: ReorderStation | null;
  /** Legs that stop existing because their stations are no longer adjacent. */
  dropped: LegChange[];
  /** Pairs that become adjacent and start as a straight line. */
  created: Array<{ from: ReorderStation; to: ReorderStation }>;
  /** Stations dated before the one in front of them in the new order — and not before. */
  dateConflicts: Array<{ station: ReorderStation; previous: ReorderStation }>;
  /** True when a dropped leg carries a recording or a hand-drawn line. */
  losesLine: boolean;
}

/** A leg whose line is somebody's work, not something the server can redo. */
export function isProtectedSource(source: LegSource): boolean {
  return source === "track" || source === "drawn";
}

const pairs = (list: readonly ReorderStation[]): Array<[ReorderStation, ReorderStation]> =>
  list.slice(1).map((s, i) => [list[i], s]);

const pairKey = (a: ReorderStation, b: ReorderStation): string => `${a.key}>${b.key}`;

/** The list with the station at `from` moved to `to`. */
export function moveStation<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function reorderImpact(
  stations: readonly ReorderStation[],
  legs: readonly TourLeg[],
  from: number,
  to: number
): ReorderImpact {
  const next = moveStation(stations, from, to);
  const oldPairs = pairs(stations);
  const newKeys = new Set(pairs(next).map(([a, b]) => pairKey(a, b)));
  const oldKeys = new Set(oldPairs.map(([a, b]) => pairKey(a, b)));
  const legOf = (a: ReorderStation, b: ReorderStation): TourLeg | null =>
    (a.id && b.id && legs.find((l) => l.fromStopId === a.id && l.toStopId === b.id)) || null;

  const dropped = oldPairs
    .filter(([a, b]) => !newKeys.has(pairKey(a, b)))
    .map(([a, b]) => ({ from: a, to: b, leg: legOf(a, b) }));
  const created = pairs(next)
    .filter(([a, b]) => !oldKeys.has(pairKey(a, b)))
    .map(([a, b]) => ({ from: a, to: b }));

  const flagged = (list: readonly ReorderStation[]): Set<string> =>
    new Set(
      stationWarnings(list)
        .filter((w) => w.kind === "beforePrevious")
        .map((w) => list[w.index].key)
    );
  const already = flagged(stations);
  const now = flagged(next);
  const dateConflicts = next.flatMap((station, index) => {
    if (index === 0 || already.has(station.key) || !now.has(station.key)) return [];
    // The station it now sits behind, skipping undated ones as the check does.
    const previous =
      [...next.slice(0, index)].reverse().find((s) => s.startDate) ?? next[index - 1];
    return [{ station, previous }];
  });

  const at = next.indexOf(stations[from]);
  return {
    moved: stations[from],
    before: next[at - 1] ?? null,
    after: next[at + 1] ?? null,
    dropped,
    created,
    dateConflicts,
    losesLine: dropped.some((d) => d.leg !== null && isProtectedSource(d.leg.source)),
  };
}

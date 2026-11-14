import type { DayContextEntry } from "./dayContext";
import type { Span } from "./readSafe";

/**
 * A silence the logbook explains (TravTrack, after rc.31). A stretch with no
 * fixes whose ends lie far apart is no stay; when the owner's own record — a
 * flight, a train, a ferry, a night in a lodging — covers it, the coverage
 * band says so instead of "no data". Only `noData` is ever replaced: recorded,
 * paused and deleted time keep their state, and an entry draws no points and
 * adds no distance — it is a label for time, nothing more.
 */

export type CoverageEntryRef = { domain: string; id: string };
export type CoveragePiece = Span & { state: string; entry?: CoverageEntryRef };

/** The context kinds that are not a logbook entry of a domain. */
const NOT_AN_ENTRY: ReadonlySet<string> = new Set(["trip", "home", "suggestion", "movement"]);

/**
 * The entries that can explain a silence: the day's visible domain entries
 * with a stated, non-empty window (an instant, or a record without times,
 * explains nothing). Earlier start first, then id, so overlaps are stable.
 */
export function explainingEntries(
  context: readonly DayContextEntry[]
): Array<Span & CoverageEntryRef> {
  return context
    .filter((e) => !NOT_AN_ENTRY.has(e.kind) && e.id !== null && e.untilMs > e.fromMs)
    .map((e) => ({ fromMs: e.fromMs, untilMs: e.untilMs, domain: e.kind, id: e.id as string }))
    .sort((a, b) => a.fromMs - b.fromMs || a.id.localeCompare(b.id));
}

/** `coverage` with each `noData` stretch an entry overlaps turned into `entry` for that part. */
export function fillWithEntries<T extends CoveragePiece>(
  coverage: readonly T[],
  entries: ReadonlyArray<Span & CoverageEntryRef>
): CoveragePiece[] {
  if (entries.length === 0) return [...coverage];
  const out: CoveragePiece[] = [];
  const push = (piece: CoveragePiece) => {
    const last = out[out.length - 1];
    const same =
      last &&
      last.state === piece.state &&
      last.untilMs === piece.fromMs &&
      last.entry?.domain === piece.entry?.domain &&
      last.entry?.id === piece.entry?.id;
    if (same) last.untilMs = piece.untilMs;
    else out.push(piece);
  };
  for (const piece of coverage) {
    if (piece.state !== "noData") {
      push({ ...piece });
      continue;
    }
    const inside = entries.filter((e) => e.fromMs < piece.untilMs && e.untilMs > piece.fromMs);
    const cuts = [
      ...new Set([
        piece.fromMs,
        piece.untilMs,
        ...inside
          .flatMap((e) => [e.fromMs, e.untilMs])
          .filter((t) => t > piece.fromMs && t < piece.untilMs),
      ]),
    ].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [fromMs, untilMs] = [cuts[k], cuts[k + 1]];
      // `entries` is ordered: the first one covering the part is the earlier-starting.
      const owner = inside.find((e) => e.fromMs <= fromMs && e.untilMs >= untilMs);
      if (owner) {
        push({ fromMs, untilMs, state: "entry", entry: { domain: owner.domain, id: owner.id } });
      } else {
        push({ fromMs, untilMs, state: "noData" });
      }
    }
  }
  return out;
}

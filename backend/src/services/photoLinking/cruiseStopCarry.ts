import type { DbTransaction } from "../../db";

/**
 * A cruise save replaces its stops (delete + create), and a stop's photo links
 * hang off the stop's id. Carried over by a stable key — the day and where the
 * ship was — so a manual pick, an automatic link and above all a REFUSAL survive
 * an edit (defect class 4: a re-derivation must not destroy good data). A stop
 * that is gone takes its links with it; nothing is left pointing at nothing.
 */
export interface KeyedStop {
  id: string;
  dayNumber: number;
  isAtSea: boolean;
  portId: number | null;
  unresolvedPortName: string | null;
}

export const stopKey = (s: Omit<KeyedStop, "id">): string =>
  `${s.dayNumber}|${s.isAtSea ? "sea" : s.portId !== null ? `p${s.portId}` : `u${(s.unresolvedPortName ?? "").trim().toLowerCase()}`}`;

/** Old stop id → new stop id, matching equal keys in order (two calls on one day stay distinct). */
export function pairStops(
  oldStops: readonly KeyedStop[],
  newStops: readonly KeyedStop[]
): Map<string, string> {
  const queues = new Map<string, string[]>();
  for (const s of newStops) queues.set(stopKey(s), [...(queues.get(stopKey(s)) ?? []), s.id]);
  const pairs = new Map<string, string>();
  for (const s of oldStops) {
    const next = queues.get(stopKey(s))?.shift();
    if (next) pairs.set(s.id, next);
  }
  return pairs;
}

type Links = Awaited<ReturnType<DbTransaction["entryPhotoLink"]["findMany"]>>;

/** Read BEFORE the delete: the cascade takes the rows with their stops. */
export function readStopLinks(tx: DbTransaction, stopIds: string[]): Promise<Links> {
  return tx.entryPhotoLink.findMany({ where: { cruiseStopId: { in: stopIds } } });
}

/** Write the saved links (manual, auto and refusals) onto the new stops. */
export async function restoreStopLinks(
  tx: DbTransaction,
  saved: Links,
  pairs: Map<string, string>
): Promise<void> {
  const data = saved.flatMap(({ id: _id, createdAt: _c, cruiseStopId, ...rest }) => {
    const next = cruiseStopId ? pairs.get(cruiseStopId) : undefined;
    return next ? [{ ...rest, cruiseStopId: next }] : [];
  });
  if (data.length > 0) await tx.entryPhotoLink.createMany({ data, skipDuplicates: true });
}

/**
 * Keeps a port call's "all aboard" time through a stops PATCH that does not
 * mention it (forgejo#223, review C1).
 *
 * A PATCH with `stops` deletes every stop and creates the list it was sent,
 * so a field the client does not send is gone. For every other stop field
 * that is the documented contract — and every shipped client round-trips them.
 * `allAboardTime` is new: the Companion's route editor, already in users'
 * hands, rebuilds each stop without it, and its first save (marking a sea day,
 * say) would have deleted every all-aboard time of the cruise without a word.
 *
 * So, for THIS field only: an incoming stop whose key is ABSENT takes the
 * value of the stored stop it is, and an explicit null or "" still clears it.
 * Stop ids change on every save, so "the stop it is" is found in passes, each
 * stored stop used at most once:
 *   1. by `id`, when the client sends one that names a stop of this cruise;
 *   2. by the same day of the cruise AND the same place;
 *   3. by the same place on any day, when exactly one stored candidate is left
 *      (a reorder renumbered the day, forgejo#126) — a round trip calling at
 *      Kiel twice is decided by the stored date, else not at all.
 * Never by day alone: a day whose port was swapped is another port, and a
 * guessed time to be back on board is worse than none. A sea day never
 * inherits one.
 */

export interface IncomingStop {
  id?: string;
  dayNumber: number;
  isAtSea: boolean;
  portId?: number | null;
  unresolvedPortName?: string | null;
  /** `YYYY-MM-DD…` as the stop schema hands it on, or null/absent. */
  date?: string | null;
  /** `undefined` = the key was not sent. */
  allAboardTime?: string | null;
}

export interface StoredStop {
  id: string;
  dayNumber: number;
  isAtSea: boolean;
  portId: number | null;
  unresolvedPortName: string | null;
  date: Date | null;
  allAboardTime: string | null;
}

/** Where a call is: a catalogue port or an imported name; null for a sea day. */
function placeOf(stop: {
  isAtSea: boolean;
  portId?: number | null;
  unresolvedPortName?: string | null;
}): string | null {
  if (stop.isAtSea) return null;
  if (stop.portId != null) return `port:${stop.portId}`;
  const name = stop.unresolvedPortName?.trim().toLowerCase();
  return name ? `name:${name}` : null;
}

const storedDay = (date: Date | null): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

/**
 * The `allAboardTime` to write for each incoming stop, in the same order:
 * the value sent where the key was sent, the matched stored value where it
 * was not, and null where no stored stop can be told to be the same call.
 */
export function carryOverAllAboard(
  incoming: readonly IncomingStop[],
  stored: readonly StoredStop[]
): (string | null)[] {
  const candidates = stored.filter((s) => placeOf(s) !== null);
  const used = new Set<string>();
  const match = new Map<number, StoredStop>();
  const take = (index: number, stop: StoredStop): void => {
    match.set(index, stop);
    used.add(stop.id);
  };
  const open = (index: number): boolean => !match.has(index) && placeOf(incoming[index]) !== null;

  // 1. By id.
  incoming.forEach((stop, index) => {
    if (!open(index) || !stop.id) return;
    const hit = candidates.find((s) => s.id === stop.id && !used.has(s.id));
    if (hit) take(index, hit);
  });
  // 2. Same day, same place.
  incoming.forEach((stop, index) => {
    if (!open(index)) return;
    const hit = candidates.find(
      (s) => !used.has(s.id) && s.dayNumber === stop.dayNumber && placeOf(s) === placeOf(stop)
    );
    if (hit) take(index, hit);
  });
  // 3. Same place on another day — only when it is unambiguous.
  incoming.forEach((stop, index) => {
    if (!open(index)) return;
    const left = candidates.filter((s) => !used.has(s.id) && placeOf(s) === placeOf(stop));
    const day = stop.date ? stop.date.slice(0, 10) : null;
    const hit =
      left.length === 1
        ? left[0]
        : day
          ? left.filter((s) => storedDay(s.date) === day).length === 1
            ? left.find((s) => storedDay(s.date) === day)
            : undefined
          : undefined;
    if (hit) take(index, hit);
  });

  return incoming.map((stop, index) => {
    if (stop.isAtSea) return null;
    if (stop.allAboardTime !== undefined) return stop.allAboardTime;
    return match.get(index)?.allAboardTime ?? null;
  });
}

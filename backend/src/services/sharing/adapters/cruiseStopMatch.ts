/**
 * Which of a member's port calls a propagated itinerary lands on.
 *
 * Matching used to be by list position, so one inserted sea day shifted every
 * later call: the member's excursion note and all-aboard time slid onto the
 * previous day's call, and the last call was deleted with whatever was on it.
 * A call is a DAY and a place. The passes, in order:
 *
 * 1. the same day and the same place;
 * 2. the same port on another day — the call moved, its notes go with it;
 * 3. the same day, port for port — the port of that day was corrected;
 * 4. the same day, any kind, but only a call with nothing private on it.
 *
 * What is left over is created (source) or removed (copy) — except a copy's
 * call carrying private fields, which is kept: deleting a member's own words
 * because someone else edited the itinerary loses data nobody can restore.
 */

export interface StopIdentity {
  dayNumber: number;
  isAtSea: boolean;
  portId: number | null;
  unresolvedPortName: string | null;
}

export interface CopyStop extends StopIdentity {
  id: string;
  excursionNote: string | null;
  allAboardTime: string | null;
}

export interface StopPlan<S> {
  updates: { copyId: string; source: S }[];
  creates: S[];
  deletes: string[];
}

const place = (s: StopIdentity): string | null => {
  if (s.isAtSea) return "sea";
  if (s.portId !== null) return `port:${s.portId}`;
  const name = s.unresolvedPortName?.trim().toLowerCase();
  return name ? `name:${name}` : null;
};

const isPort = (s: StopIdentity) => !s.isAtSea;

export const hasPrivateFields = (s: CopyStop): boolean =>
  !!s.excursionNote?.trim() || !!s.allAboardTime?.trim();

export function planStopMatch<S extends StopIdentity>(
  sources: readonly S[],
  copies: readonly CopyStop[]
): StopPlan<S> {
  const openSources = new Set(sources.map((_, i) => i));
  const openCopies = new Set(copies.map((_, i) => i));
  const updates: StopPlan<S>["updates"] = [];

  const take = (si: number, ci: number) => {
    openSources.delete(si);
    openCopies.delete(ci);
    updates.push({ copyId: copies[ci].id, source: sources[si] });
  };
  const pass = (fits: (s: S, c: CopyStop) => boolean, rank?: (s: S, c: CopyStop) => number) => {
    for (const si of [...openSources]) {
      const candidates = [...openCopies].filter((ci) => fits(sources[si], copies[ci]));
      if (candidates.length === 0) continue;
      const best = rank
        ? candidates.reduce((a, b) =>
            rank(sources[si], copies[b]) < rank(sources[si], copies[a]) ? b : a
          )
        : candidates[0];
      take(si, best);
    }
  };

  pass((s, c) => s.dayNumber === c.dayNumber && place(s) !== null && place(s) === place(c));
  pass(
    (s, c) => isPort(s) && place(s) !== null && place(s) === place(c),
    (s, c) => Math.abs(s.dayNumber - c.dayNumber)
  );
  pass((s, c) => s.dayNumber === c.dayNumber && isPort(s) && isPort(c));
  pass((s, c) => s.dayNumber === c.dayNumber && !hasPrivateFields(c));

  return {
    updates,
    creates: [...openSources].map((i) => sources[i]),
    deletes: [...openCopies].filter((i) => !hasPrivateFields(copies[i])).map((i) => copies[i].id),
  };
}

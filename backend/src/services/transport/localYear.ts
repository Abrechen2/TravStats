/**
 * "Which of this user's rides left in calendar year Y on the departure
 * terminal's own calendar" — the one skeleton behind rail, bus, ferry and
 * rental (forgejo#382). The year is derived per row from its zone, so it
 * cannot be one SQL range: the widest UTC window any zone could put in that
 * year is read (ids and clocks only), the domain's rule picks the rows, and
 * the list query takes their ids.
 */

/** UTC+14 is the furthest zone ahead of UTC, UTC-12 the furthest behind. */
export const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
export const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

export interface UtcWindow {
  gte: Date;
  lt: Date;
}

/** The widest UTC window that can contain any instant of `year` in some zone. */
export function utcWindowForLocalYear(year: number): UtcWindow {
  return {
    gte: new Date(Date.UTC(year, 0, 1) - MAX_AHEAD_OF_UTC_MS),
    lt: new Date(Date.UTC(year + 1, 0, 1) + MAX_BEHIND_UTC_MS),
  };
}

/**
 * @param fetchCandidates reads `{ id, clock, zone }` rows inside the window
 * @param yearOf          the domain's per-row year rule (`railYear`, …)
 */
export async function idsInLocalYear<Row extends { id: string }>(
  year: number,
  fetchCandidates: (window: UtcWindow) => Promise<Row[]>,
  yearOf: (row: Row) => number | null
): Promise<string[]> {
  const candidates = await fetchCandidates(utcWindowForLocalYear(year));
  return candidates.filter((row) => yearOf(row) === year).map((row) => row.id);
}

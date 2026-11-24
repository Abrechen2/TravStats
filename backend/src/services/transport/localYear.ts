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

/** The widest UTC window that can contain any instant of the local month in some zone. */
export function utcWindowForLocalMonth(year: number, month: number): UtcWindow {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1) - MAX_AHEAD_OF_UTC_MS),
    lt: new Date(Date.UTC(year, month, 1) + MAX_BEHIND_UTC_MS),
  };
}

/**
 * `idsInLocalYear` for one month of it (`?year=&month=`, from a statistics year card).
 * @param dayOf the row's local calendar day, `YYYY-MM-DD` — the day the domain's year rule reads
 */
export async function idsInLocalMonth<Row extends { id: string }>(
  year: number,
  month: number,
  fetchCandidates: (window: UtcWindow) => Promise<Row[]>,
  dayOf: (row: Row) => string
): Promise<string[]> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const candidates = await fetchCandidates(utcWindowForLocalMonth(year, month));
  return candidates.filter((row) => dayOf(row).startsWith(key)).map((row) => row.id);
}

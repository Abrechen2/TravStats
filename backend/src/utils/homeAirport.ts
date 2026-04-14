/**
 * Home airport history utilities.
 *
 * A user's home airport can change over time ("Umzug" / relocation). Stats
 * that treat the home airport specially (e.g. layover detection, distance
 * from home) must use the home airport that was active at the time each
 * flight happened, not the current one — otherwise changing the home
 * airport retroactively rewrites history.
 *
 * The history is stored as a JSON array in `UserSettings.data.homeAirportHistory`.
 * Entries are open-ended intervals: `toDate === null` marks the currently
 * active home airport. Entries must not overlap and are kept in chronological
 * order (oldest first).
 */

export interface HomeAirportEntry {
  /** IATA code (preferred) or ICAO if IATA unknown. Always uppercased. */
  iata: string;
  /** Inclusive start date in YYYY-MM-DD. */
  fromDate: string;
  /** Exclusive end date in YYYY-MM-DD, or null if still active. */
  toDate: string | null;
}

function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Return the IATA code that was the user's home at the given date, or null
 * if no entry covers that date. Dates are YYYY-MM-DD; the comparison is
 * inclusive on fromDate and exclusive on toDate.
 */
export function getHomeAirportAt(
  history: HomeAirportEntry[] | null | undefined,
  date: string
): string | null {
  if (!history || history.length === 0) return null;
  for (const entry of history) {
    if (compareYmd(entry.fromDate, date) > 0) continue;
    if (entry.toDate !== null && compareYmd(entry.toDate, date) <= 0) continue;
    return entry.iata;
  }
  return null;
}

/** Current home airport (the single entry with toDate === null), or null. */
export function getCurrentHomeAirport(
  history: HomeAirportEntry[] | null | undefined
): string | null {
  if (!history || history.length === 0) return null;
  const open = history.find((e) => e.toDate === null);
  return open ? open.iata : null;
}

/**
 * Return a new history with a "move" applied. If there is an open entry its
 * toDate is set to the move date (closing the previous home); a new open
 * entry starts at the same date with the new airport. History is kept
 * chronologically sorted. If the newIata equals the currently active one
 * the history is returned unchanged so repeated POSTs are idempotent.
 */
export function applyHomeAirportMove(
  history: HomeAirportEntry[],
  newIata: string,
  moveDate: string
): HomeAirportEntry[] {
  const normalized = newIata.trim().toUpperCase();
  const current = getCurrentHomeAirport(history);
  if (current === normalized) return history;

  const updated: HomeAirportEntry[] = history.map((entry) =>
    entry.toDate === null ? { ...entry, toDate: moveDate } : entry
  );
  updated.push({ iata: normalized, fromDate: moveDate, toDate: null });
  return sortHistory(updated);
}

export function sortHistory(history: HomeAirportEntry[]): HomeAirportEntry[] {
  return [...history].sort((a, b) => compareYmd(a.fromDate, b.fromDate));
}

/**
 * Validate and normalize a history array loaded from persistence. Silently
 * drops malformed entries instead of throwing so a single bad record cannot
 * break stats for an entire user.
 */
export function normalizeHistory(raw: unknown): HomeAirportEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: HomeAirportEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const iata = typeof rec.iata === 'string' ? rec.iata.trim().toUpperCase() : null;
    const fromDate = typeof rec.fromDate === 'string' ? rec.fromDate : null;
    const toDate =
      rec.toDate === null || rec.toDate === undefined
        ? null
        : typeof rec.toDate === 'string'
          ? rec.toDate
          : undefined;
    if (!iata || !fromDate || toDate === undefined) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) continue;
    if (toDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) continue;
    result.push({ iata, fromDate, toDate });
  }
  return sortHistory(result);
}

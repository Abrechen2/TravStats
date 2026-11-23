/** The endpoints' own page cap (rail, stays, bus, ferry, rental, cruise lists all stop at 500). */
export const COLLECT_PAGE_SIZE = 500;

/**
 * "Alle Treffer auswählen" reads at most this many matches. Beyond it the
 * button is not offered at all (the bar says so) instead of silently selecting
 * a prefix of the set: a bulk edit must act on exactly what the count named.
 */
export const BULK_SELECT_MAX = 5000;

/**
 * Every item of a server-paged list, one page of `COLLECT_PAGE_SIZE` at a
 * time, through the SAME query the list itself sends — so "all matches" is
 * decided by the server's filter and never re-derived in the browser. A
 * failed page rejects the whole read: a partial prefix would be a selection
 * nobody asked for.
 */
export async function collectAllPages<T>(
  fetchPage: (page: {
    limit: number;
    offset: number;
  }) => Promise<{ items: readonly T[]; total: number }>
): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; ; offset += COLLECT_PAGE_SIZE) {
    const page = await fetchPage({ limit: COLLECT_PAGE_SIZE, offset });
    items.push(...page.items);
    if (page.items.length < COLLECT_PAGE_SIZE || items.length >= page.total) return items;
    if (items.length >= BULK_SELECT_MAX) return items;
  }
}

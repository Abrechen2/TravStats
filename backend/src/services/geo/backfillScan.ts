/**
 * Which rows a backfill pass feeds to the geocoder.
 *
 * A backfill is bounded because the geocoder is: one request per second,
 * process-wide, so `limit` attempts is also a wall-clock budget in seconds.
 * The bound has to sit on the WORK — the rows handed to the geocoder — and
 * not on the SCAN that looks for them. Until 2026-09-04 both the place and
 * the lodging pass read a user's first 500 rows and filtered those, so a row
 * past the 500th was never even looked at, and an account with more complete
 * rows than the page size could not get an address for anything newer
 * (forgejo#43). "Bounded" had become "the first page, forever".
 *
 * The predicate cannot go into the WHERE: "needs an address" includes
 * "has one in a script the reader cannot read" (see `shared/geo/latinScript`),
 * which no Prisma filter expresses. So the scan walks the rows in pages and
 * applies the predicate in code, stopping as soon as `limit` candidates are
 * in hand. Reading a page costs one query over six narrow columns; a user
 * with ten thousand complete places costs twenty such queries and no
 * geocoder call at all.
 *
 * Shared by `services/places/addressBackfill.ts` and
 * `services/lodging/geocodeBackfill.ts` so the two passes cannot drift apart
 * on this again.
 */

/** Rows read per query. Not a bound on anything the user sees. */
export const BACKFILL_SCAN_PAGE = 500;

export interface ScanOptions<T> {
  /**
   * Load the next page: every row after `afterId` in the pass's own order,
   * at most `take` of them. `null` asks for the first page. The order must be
   * total (a unique tie-breaker), or a page boundary can skip or repeat a row.
   */
  loadPage: (afterId: string | null, take: number) => Promise<T[]>;
  /** Does this row need the geocoder? */
  needsWork: (row: T) => boolean;
  /** How many candidates to hand back at most. */
  limit: number;
  pageSize?: number;
}

/**
 * Walk the rows page by page and return the first `limit` that need work.
 *
 * Returns fewer only when the rows run out. Never throws for an empty table.
 */
export async function collectBackfillCandidates<T extends { id: string }>(
  opts: ScanOptions<T>,
): Promise<T[]> {
  const pageSize = opts.pageSize ?? BACKFILL_SCAN_PAGE;
  const out: T[] = [];
  let afterId: string | null = null;

  while (out.length < opts.limit) {
    const page = await opts.loadPage(afterId, pageSize);
    if (page.length === 0) break;

    for (const row of page) {
      if (out.length >= opts.limit) break;
      if (opts.needsWork(row)) out.push(row);
    }

    if (page.length < pageSize) break;
    afterId = page[page.length - 1].id;
  }

  return out;
}

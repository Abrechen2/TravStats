import type { Response } from "express";
import { z } from "zod";

/**
 * `?year=` for the domain rollups (`/stats/cruise`, `/stats/lodging`).
 *
 * Deliberately NOT `SummaryQuerySchema`: that one also carries `fromDate`,
 * `toDate` and `compareYear`, and a schema is a promise. These endpoints
 * honour a year and nothing else, so advertising the rest would be a contract
 * they do not keep.
 *
 * Comparison is two requests rather than a `{ current, compare }` body. The
 * flights summary answers both years at once because it already had that
 * shape; giving these a second shape would put a router that speaks the
 * enveloped family into two answers for one route, which
 * `docs/adr/0001-api-response-shape.md` is there to prevent.
 */
export const YearQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

/**
 * Reads `?year=`. Answers 400 itself and returns `null` when the query is
 * invalid, so a handler only has to stop; `undefined` is the lifetime view.
 */
export function readYearQuery(query: unknown, res: Response): number | undefined | null {
  const parsed = YearQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
    return null;
  }
  return parsed.data.year;
}

/**
 * The calendar year as a half-open UTC window, for the domains whose events
 * are dated by when they BEGIN.
 *
 * That rule is not a choice made here — `Overview/aggregate.ts` already states
 * it for the cross-domain overview: "count the event once, in the year it
 * started. A cruise that spans 2023-12-30 → 2024-01-02 contributes 1 to year
 * 2023 only." The domain tabs have to answer the same question the same way,
 * or the overview and the tab it links to disagree about the same cruise.
 *
 * Half-open (`gte` / `lt`) rather than a 31 December end: an inclusive upper
 * bound built from a date literal silently drops everything after midnight on
 * the last day.
 */
export function yearWindow(year: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

/**
 * A Prisma `where` fragment: nothing for the lifetime view, the year's window
 * on `field` otherwise.
 *
 * A row whose date is null cannot be placed in a year at all, so a year
 * request drops it rather than guessing; the lifetime view still counts it.
 * Cruises are dated by `startDate`, stays by `checkIn` — the night the stay
 * began, so a stay over New Year belongs to the year it started in both the
 * overview and the tab.
 */
export function startedIn<K extends string>(
  field: K,
  year: number | undefined
): Partial<Record<K, { gte: Date; lt: Date }>> {
  if (year === undefined) return {};
  return { [field]: yearWindow(year) } as Record<K, { gte: Date; lt: Date }>;
}

/**
 * Under a year filter the house list follows the stays.
 *
 * A house has no date — only a stay does. Left unfiltered, a year request
 * would answer "3 nights in 2024" beside "4 houses, 2 of them merely
 * bookmarked", and the second half would be a lifetime figure wearing a year's
 * label. That mixed answer is the very thing the overview and the tabs were
 * caught disagreeing about.
 *
 * A bookmarked house (`visited: false`, never slept in) therefore belongs to
 * the lifetime view and to no year at all.
 */
export function scopeLodgingsToStays<L extends { id: string }>(
  lodgings: L[],
  stays: ReadonlyArray<{ lodgingId: string }>,
  year: number | undefined
): L[] {
  if (year === undefined) return lodgings;
  const stayedAt = new Set(stays.map((stay) => stay.lodgingId));
  return lodgings.filter((l) => stayedAt.has(l.id));
}

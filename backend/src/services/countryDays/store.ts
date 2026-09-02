/**
 * Persisting country-days — the only writer of the `country_days` table.
 *
 * ## Replace, do not upsert
 *
 * A window is written by DELETING every row this source holds inside it and
 * inserting what was just observed. An upsert would be idempotent for rows that
 * are still true and silently wrong for rows that are not: if a re-sweep of
 * March finds Estonia where the first sweep found Estonia *and* Latvia —
 * because the first sweep was truncated, or because the user corrected their
 * Dawarich data — an upsert leaves Latvia in the passport for ever, with no
 * record able to explain it. Replacement makes the table a projection of what
 * Dawarich says now, which is the only shape a re-sweep can converge on.
 *
 * It is scoped to ONE source, so a `dawarich` sweep can never delete a day a
 * future GPX reducer wrote. That scoping is why `source` is in the unique key.
 *
 * ## Why one transaction
 *
 * Between the delete and the insert the account has no country-days for that
 * window. A passport read landing in that gap would report a country count that
 * is briefly too low — a number moving for no reason the user can see, which
 * §5 of the design calls out as reading like data loss. The pair is atomic so
 * the gap is never observable.
 */

import { prisma } from "../../db";
import type { CountryDaySource } from "./countryDaySource";
import type { CountryDayObservation } from "./reduce";

/** Half-open, `[startAt, endAtExclusive)`, both at UTC midnight. */
export interface CountryDayWindow {
  startAt: Date;
  endAtExclusive: Date;
}

export interface ReplaceCountryDaysResult {
  /** Rows deleted — what the window held before. */
  removed: number;
  /** Rows written — what it holds now. */
  written: number;
}

/** `YYYY-MM-DD` -> midnight UTC, the form the `date` column stores. */
export function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Make `window` hold exactly `observations` for this user and source.
 *
 * `partialDays` names the UTC days whose window stayed truncated even after
 * subdivision (see `services/dawarich/countryDaySweep.ts`). Those rows are
 * written with `partialWindow: true` — the country is still proved, but the
 * day's SILENCE is withdrawn, because Dawarich answers newest-first and the
 * older part of that day was never read. A partial window recorded as if whole
 * is the measurement that lies, which is the rule `dawarichClient.ts`'s own
 * header states about `truncated`.
 *
 * An observation dated outside `window` is dropped rather than written: it
 * would survive the delete of every later re-sweep of its own window and become
 * a row nothing can correct.
 */
export async function replaceCountryDays(
  userId: string,
  source: CountryDaySource,
  window: CountryDayWindow,
  observations: readonly CountryDayObservation[],
  partialDays: ReadonlySet<string> = new Set(),
): Promise<ReplaceCountryDaysResult> {
  const rows = observations
    .map((observation) => ({
      userId,
      source,
      date: utcMidnight(observation.date),
      countryCode: observation.countryCode,
      pointCount: observation.pointCount,
      spanKm: observation.spanKm,
      partialWindow: partialDays.has(observation.date),
    }))
    .filter(
      (row) =>
        row.date.getTime() >= window.startAt.getTime() &&
        row.date.getTime() < window.endAtExclusive.getTime(),
    );

  const [deleted] = await prisma.$transaction([
    prisma.countryDay.deleteMany({
      where: {
        userId,
        source,
        date: { gte: window.startAt, lt: window.endAtExclusive },
      },
    }),
    ...(rows.length > 0 ? [prisma.countryDay.createMany({ data: rows })] : []),
  ]);

  return { removed: deleted.count, written: rows.length };
}

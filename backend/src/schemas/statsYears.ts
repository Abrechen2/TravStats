import { z } from "./zod";

/**
 * `GET /stats/years`. A month or a year without a measured distance is `null`, never a zero;
 * `recordedKm` (TravTrack) is NOT part of `loggedKm` — a recording can contain a logged ride.
 */
const yearMonth = z.object({
  month: z.number().int().min(1).max(12),
  loggedKm: z.number().nullable(),
  byDomain: z
    .record(z.string(), z.number())
    .openapi({ description: "Logged km by domain key; only domains with a distance." }),
  recordedKm: z.number().nullable(),
  recordedPending: z
    .boolean()
    .openapi({ description: "TravTrack's projection still owes this month's recorded km." }),
});

export const yearStatsSchema = z.object({
  totals: z.object({
    loggedKm: z.number().nullable(),
    recordedKm: z.number().nullable(),
    recordedPoints: z.number().int().nullable(),
  }),
  years: z.array(
    z.object({
      year: z.number().int(),
      loggedKm: z.number().nullable(),
      recordedKm: z.number().nullable(),
      recordedPending: z.boolean(),
      months: z.array(yearMonth).length(12).openapi({ description: "January first." }),
      byPurpose: z
        .array(
          z.object({
            key: z.string().nullable().openapi({
              description: "`builtin:<key>` | `custom:<uuid>`; null: entries without a purpose",
            }),
            count: z.number().int(),
            km: z.number().nullable(),
          })
        )
        .openapi({ description: "Entries and km per purpose (Nach Zweck), most entries first." }),
    })
  ),
});

/**
 * `GET /stats/years/counts`: how many entries each year holds, per domain, under the same
 * counting rules as `/stats/years` (the entries it measures distance over). The caption under a
 * year in the year picker; a year with no countable entry is absent, never zero.
 */
export const yearCountsSchema = z.object({
  years: z.array(
    z.object({
      year: z.number().int(),
      total: z.number().int(),
      byDomain: z.record(z.string(), z.number().int()).openapi({
        description: "Entries by domain key; only domains with at least one entry that year.",
      }),
    })
  ),
});

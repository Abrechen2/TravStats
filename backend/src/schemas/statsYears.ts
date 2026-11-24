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
      months: z.array(yearMonth).length(12).openapi({ description: "January first." }),
    })
  ),
});

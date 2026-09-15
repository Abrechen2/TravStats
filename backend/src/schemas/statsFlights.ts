import { z } from "./zod";

/**
 * The shapes the flight-side `/stats` endpoints answer with.
 *
 * Same arrangement as `statsAircraft.ts`, and for the same reason: the routes
 * INFER their types from these, so the published contract and the handler are
 * one description rather than two with a "keep in sync" comment between them
 * (forgejo#52).
 *
 * The prose on each field is the reasoning that was already in the route, moved
 * rather than rewritten — a consumer reading the spec needs the same caveats a
 * reader of the code needs. Most of them are about WHAT IS NOT COUNTED, which
 * is the thing a bare type can never say.
 */

// ─── /stats/punctuality ──────────────────────────────────────────────────────

export const punctualityGroupSchema = z.object({
  key: z.string().openapi({ description: "The airline or route this group is for." }),
  avgDelayMinutes: z.number(),
  flights: z.number().int(),
});

export const punctualityStatsSchema = z.object({
  sampleSize: z.number().int().openapi({
    description:
      "Flights that carry a delay figure — the sample every number here rests " +
      "on. A flight with scheduled times alone is NOT counted as on time; it is " +
      "outside the sample entirely.",
  }),
  avgDelayMinutes: z.number(),
  onTimeRate: z.number().openapi({
    description:
      "Share (0-1) of sampled flights that departed under the 15-minute grace. " +
      "Strictly under: a delay of exactly 15 minutes is already late.",
  }),
  bestAirline: punctualityGroupSchema.nullable().openapi({
    description:
      "Null until some airline has at least three sampled flights. One bad day " +
      "should not crown or condemn a carrier.",
  }),
  worstAirline: punctualityGroupSchema.nullable(),
  worstRoute: punctualityGroupSchema.nullable(),
});

// ─── /stats/seats ────────────────────────────────────────────────────────────

export const seatStatsSchema = z.object({
  windowCount: z.number().int(),
  middleCount: z.number().int(),
  aisleCount: z.number().int(),
  unknownCount: z.number().int().openapi({
    description: "A seat was recorded, but its letter does not map to a position.",
  }),
  noSeatCount: z.number().int().openapi({
    description: "No seat was recorded at all — kept apart from `unknownCount` on purpose.",
  }),
  frontCount: z.number().int(),
  middleZoneCount: z.number().int(),
  backCount: z.number().int(),
  mostCommonSeat: z.string().nullable(),
  seatClassDistribution: z.record(z.string(), z.number().int()),
  avgRowNumber: z.number().nullable().openapi({
    description: "Null when no seat carried a row number — not 0, which would read as row one.",
  }),
});

// ─── /stats/airlines ─────────────────────────────────────────────────────────

export const airlineRankingItemSchema = z.object({
  airline: z.string(),
  count: z.number().int(),
  percentage: z.number(),
  iata: z.string().optional().openapi({
    description: "IATA code via strict exact lookup; absent when nothing matches.",
  }),
});

export const airlineRankingResponseSchema = z.object({
  airlines: z.array(airlineRankingItemSchema),
  total: z.number().int(),
  flightsWithoutAirline: z.number().int().openapi({
    description:
      "Flights carrying no airline. Excluded from the ranking AND from the " +
      "percentage denominator, reported so the gap is visible rather than " +
      "ranked as a carrier called \"Unknown\".",
  }),
});

// ─── /stats/countries ────────────────────────────────────────────────────────

export const countryStatSchema = z.object({
  country: z.string(),
  count: z.number().int(),
});

export const countryStatsResponseSchema = z.object({
  countries: z.array(countryStatSchema).openapi({
    description: "Display vocabulary, ranked by flight count. Rendered as-is.",
  }),
  total: z.number().int(),
  countriesIso: z.array(z.string()).openapi({
    description:
      "Counting vocabulary: lifetime countries VISITED as ISO alpha-2 — every " +
      "country either end of a flight touched, not only departures — with " +
      "\"Unknown\" and the catalogue's placeholders dropped. Entries that cannot " +
      "be resolved are left out rather than counted as things that cannot be " +
      "deduplicated.",
  }),
  byYear: z.record(z.string(), z.array(z.string())).openapi({
    description:
      "Visited countries keyed by year, same ISO vocabulary. Both ends of a " +
      "flight land in its DEPARTURE year, so a red-eye is one journey rather " +
      "than a country visited in a year the traveller never flew. The year is " +
      "the one on the clock at the departure airport, not the UTC instant; a " +
      "flight with no departure time still counts towards `countries` but " +
      "belongs to no year.",
  }),
});

export type PunctualityGroup = z.infer<typeof punctualityGroupSchema>;
export type PunctualityStats = z.infer<typeof punctualityStatsSchema>;
export type SeatStats = z.infer<typeof seatStatsSchema>;
export type AirlineRankingItem = z.infer<typeof airlineRankingItemSchema>;
export type AirlineRankingResponse = z.infer<typeof airlineRankingResponseSchema>;
export type CountryStat = z.infer<typeof countryStatSchema>;
export type CountryStatsResponse = z.infer<typeof countryStatsResponseSchema>;

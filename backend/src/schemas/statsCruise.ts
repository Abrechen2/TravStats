import { z } from "./zod";

/**
 * The shape of `GET /stats/cruise`.
 *
 * Described once, so the spec and the handler cannot say different things
 * (forgejo#52). Note that this is the WIRE shape, not the internal
 * `CruiseStats`: the route turns several `Set`s into sorted arrays on the way
 * out, and a schema that copied the internal type would describe something no
 * client ever receives.
 */

export const cruiseStatsResponseSchema = z.object({
  cruisesCount: z.number().int(),
  cruisePortsUnique: z.number().int(),
  cruisePortsSingleMax: z.number().int(),
  cruiseShipsUnique: z.number().int(),
  cruiseLinesUnique: z.number().int(),
  cruiseLineLoyaltyMax: z.number().int(),

  cruiseLines: z.array(z.string()).openapi({
    description:
      "Ranked by how often they were sailed, ties alphabetical. The cross-domain " +
      'tile slices the first five and labels them "Top", so a purely alphabetical ' +
      "list put AIDA and Costa there for their initials rather than for having " +
      "been sailed.",
  }),
  resolvedPortCalls: z.number().int(),
  seaDays: z.number().int(),
  seaDaysStreak: z.number().int(),

  regions: z.array(z.string()),
  regionVisitCounts: z.record(z.string(), z.number().int()),

  countries: z.array(z.string()).openapi({
    description:
      "Display vocabulary: English names, rendered as-is in the cruise tab's " +
      "country tag cloud. Do NOT switch these to codes.",
  }),
  countriesIso: z.array(z.string()).openapi({
    description:
      "Counting vocabulary: ISO alpha-2, so the cross-domain figure can union " +
      'these with the airport catalogue\'s codes without counting "Germany" and ' +
      '"DE" as two countries. A port whose name does not resolve is dropped from ' +
      "the COUNT rather than counted under its raw name — an unresolvable name " +
      "cannot be deduplicated against anything.",
  }),
  countriesByYear: z.record(z.string(), z.array(z.string())).openapi({
    description:
      "Keyed by the cruise's start year, so the overview's \"countries visited\" " +
      "tile can answer for a selected year instead of showing the lifetime set " +
      "with a delta on top that could only ever read zero.",
  }),

  totalDistanceKm: z
    .number()
    .int()
    .openapi({
      description:
        "From the computed sea legs. A cruise the router never ran for contributes " +
        "0 rather than a straight-line guess.",
    }),
  longestLegKm: z.number().int(),

  totalPortCalls: z.number().int(),
  totalCruiseDays: z.number().int(),

  hasBalconyCabin: z.boolean(),
  hasSuiteCabin: z.boolean(),
  maxDeck: z.number().int().openapi({
    description: "0 when no cruise recorded a deck — the counter starts there.",
  }),

  hasCanalTransit: z.boolean(),
  hasPolar: z.boolean(),
  hasColdWater: z.boolean(),
  hasDatelineCrossing: z.boolean(),
  hasBirthdayAtSea: z.boolean(),
  hasNewYearsAtSea: z.boolean(),
});

export type CruiseStatsResponse = z.infer<typeof cruiseStatsResponseSchema>;

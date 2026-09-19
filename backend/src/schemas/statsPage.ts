/**
 * `GET /stats/page` — the composed statistics payload (forgejo#49).
 *
 * The shape lives here so the route, the composition service, the query schema
 * and the OpenAPI spec all describe ONE thing (forgejo#52). Every section is
 * the response schema of the endpoint it mirrors, imported rather than
 * restated: a section whose shape drifted from its endpoint would be the
 * defect this endpoint exists to avoid.
 */

import { z } from "./zod";
import {
  airlineRankingResponseSchema,
  airportStatsSchema,
  businessStatsSchema,
  countryStatsResponseSchema,
  funStatsSchema,
  punctualityStatsSchema,
  seatStatsSchema,
  uniqueStatsSchema,
} from "./statsFlights";
import { aircraftRankingResponseSchema } from "./statsAircraft";

/**
 * The sections this endpoint can compose. Each name is the tail of the
 * `/stats/*` endpoint it mirrors, so the two can be checked against each
 * other by name alone.
 *
 * `/stats/summary` and `/stats/timeseries` are absent on purpose — see the
 * header of `services/stats/statsPage.ts`: neither reads the population this
 * endpoint loads, so composing them would buy no scan and risk a quietly
 * different answer under a familiar name.
 */
export const STATS_PAGE_SECTIONS = [
  "fun",
  "business",
  "unique",
  "airports",
  "seats",
  "countries",
  "airlines",
  "aircraft",
  "punctuality",
] as const;

export type StatsPageSection = (typeof STATS_PAGE_SECTIONS)[number];

/**
 * Every section is OPTIONAL, and present exactly when `include` asked for it.
 * The statistics page's sections are individually hideable, so which of these
 * a reader needs is a property of their own settings.
 */
export const statsPageResponseSchema = z.object({
  fun: funStatsSchema.optional(),
  business: businessStatsSchema.optional(),
  unique: uniqueStatsSchema.optional(),
  airports: airportStatsSchema.optional(),
  seats: seatStatsSchema.optional(),
  countries: countryStatsResponseSchema.optional(),
  airlines: airlineRankingResponseSchema.optional(),
  aircraft: aircraftRankingResponseSchema.optional(),
  punctuality: punctualityStatsSchema.optional(),
});

export type StatsPageResponse = z.infer<typeof statsPageResponseSchema>;

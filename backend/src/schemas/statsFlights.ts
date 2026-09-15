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

// ─── /stats/routes ───────────────────────────────────────────────────────────

const routeEndSchema = z.object({
  iata: z.string().optional(),
  name: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
});

export const routeRankingItemSchema = z.object({
  route: z.string().openapi({ example: "FRA-JFK" }),
  count: z.number().int(),
  departure: routeEndSchema,
  arrival: routeEndSchema,
  distance: z.number(),
});

export const routeRankingResponseSchema = z.object({
  routes: z.array(routeRankingItemSchema).openapi({
    description:
      "Most-flown first. A pair is one route whichever way it was flown, so " +
      "`departure` and `arrival` are simply the two ends — they name the first " +
      "flight of the pair that was seen, and the distance is the same either way.",
  }),
});

// ─── /stats/business ─────────────────────────────────────────────────────────

export const businessStatsSchema = z.object({
  costPerKm: z.number(),
  costPerHour: z.number(),
  totalCost: z.number().nullable().openapi({
    description: "Null when nothing carries a price — not 0, which would read as free.",
  }),
  totalDistance: z.number(),
  seatClassDistribution: z.record(z.string(), z.number().int()),
  mostCommonCategory: z.string().nullable(),
  airportDiversity: z.number(),
  avgFlightDuration: z.number(),
  busiestMonth: z.string().nullable(),
  busiestMonthFlights: z.number().int(),
  categoryDistribution: z.record(z.string(), z.number().int()),
});

// ─── /stats/unique ───────────────────────────────────────────────────────────

const layoverSchema = z.object({
  hours: z.number(),
  from: z.string(),
  to: z.string(),
});

export const uniqueStatsSchema = z.object({
  timeTravelIndex: z.number(),
  equatorCrossings: z.number().int(),
  arcticFlights: z.number().int(),
  oceanCrossings: z.number().int(),
  highestAirport: z
    .object({ code: z.string(), name: z.string(), altitude: z.number() })
    .nullable(),
  northernmost: z.object({ lat: z.number(), code: z.string() }).nullable(),
  southernmost: z.object({ lat: z.number(), code: z.string() }).nullable(),
  longestTravelChain: z.number().int(),
  fastestRoute: z.object({ route: z.string(), speed: z.number() }).nullable(),
  mostCountriesInDay: z.number().int(),
  mostCountriesDate: z.string().nullable(),
  hemisphereHops: z.number().int(),
  dateLineCrossings: z.number().int(),
  continentalExplorer: z.number().int(),
  continents: z.array(z.string()),
  tropicsTraveler: z.number().int(),
  eastWestBalance: z.object({
    eastward: z.number().int(),
    westward: z.number().int(),
    ratio: z.number(),
  }),
  sameDayFlights: z.number().int(),
  midnightFlights: z.number().int(),
  seasonalExplorer: z.boolean(),
  seasonsCount: z.number().int(),
  internationalVsDomestic: z.object({
    international: z.number().int(),
    domestic: z.number().int(),
    ratio: z.number(),
  }),
  longestLayover: layoverSchema.nullable(),
  shortestLayover: layoverSchema.nullable(),
  roundTripMaster: z.number().int(),
});

// ─── /stats/airports ─────────────────────────────────────────────────────────

const airportRefSchema = z.object({
  code: z.string(),
  name: z.string().nullable(),
  country: z.string().nullable(),
});

export const airportStatsSchema = z.object({
  airportCount: z.number().int().openapi({
    description: "Distinct airports ever used, as departure OR arrival.",
  }),
  countryCount: z.number().int(),
  continentCount: z.number().int(),
  continentTotal: z.number().int().openapi({
    description:
      "The denominator for `continentCount` — how many continents the shared " +
      "table knows, Antarctica included. Sent rather than hard-coded on the " +
      "client: the tile printed \"/ 6\" for months while its own caption said " +
      "\"of the 7\". One source, one number.",
  }),
  topAirports: z.array(airportRefSchema.extend({ visits: z.number().int() })),
  rarestAirports: z.array(airportRefSchema).openapi({
    description: "Airports visited exactly once. Capped, to keep the payload small.",
  }),
  newThisYear: z.array(airportRefSchema.extend({ firstVisitDate: z.string() })),
  farthestFromHome: airportRefSchema
    .extend({ distanceKm: z.number(), homeCode: z.string() })
    .nullable()
    .openapi({
      description:
        "\"Home\" is the home airport that was active on the flight's date, not " +
        "today's.",
    }),
  topCountries: z.array(z.object({ country: z.string(), count: z.number().int() })),
  continentDistribution: z.record(z.string(), z.number().int()).openapi({
    description:
      "Flights per continent, keyed by the name `utils/continents.ts` gives. " +
      "\"Other\" holds the flights whose airport resolved to NO continent — the " +
      "absence of one, never a further one.",
  }),
});

export type PunctualityGroup = z.infer<typeof punctualityGroupSchema>;
export type PunctualityStats = z.infer<typeof punctualityStatsSchema>;
export type SeatStats = z.infer<typeof seatStatsSchema>;
export type AirlineRankingItem = z.infer<typeof airlineRankingItemSchema>;
export type AirlineRankingResponse = z.infer<typeof airlineRankingResponseSchema>;
export type CountryStat = z.infer<typeof countryStatSchema>;
export type CountryStatsResponse = z.infer<typeof countryStatsResponseSchema>;
export type RouteRankingResponse = z.infer<typeof routeRankingResponseSchema>;
export type BusinessStats = z.infer<typeof businessStatsSchema>;
export type UniqueStats = z.infer<typeof uniqueStatsSchema>;
export type AirportStats = z.infer<typeof airportStatsSchema>;

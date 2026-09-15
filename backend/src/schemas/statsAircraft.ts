import { z } from "./zod";

/**
 * The shapes `/stats/aircraft*` answers with.
 *
 * These live here, not in the OpenAPI path file, because the route DERIVES its
 * types from them (`z.infer`). Writing the schema in the spec and the interface
 * in the route would be two descriptions of one thing with a "keep in sync"
 * comment between them — the arrangement this codebase has already watched
 * drift once, in `utils/continents.ts`.
 *
 * Answers forgejo#52 for these three: a documented 200 that carries no schema
 * satisfies the coverage check while telling a consumer nothing. A generated
 * client gets `unknown` and an agent has to guess, and the spec looks complete
 * while it is not.
 */

export const aircraftTypeItemSchema = z.object({
  aircraft: z.string().openapi({ example: "Airbus A320neo" }),
  count: z.number().int(),
  percentage: z.number().openapi({
    description:
      "Share of the user's total flights. The denominator is every counted " +
      "flight, not only those carrying an aircraft — so the percentages need " +
      "not sum to 100, and the gap is the flights with no type recorded.",
  }),
});

export const aircraftTypesResponseSchema = z.object({
  aircraftTypes: z.array(aircraftTypeItemSchema),
  total: z.number().int().openapi({
    description:
      "The user's total flight count, shared as a denominator with " +
      "/stats/airlines so the two rankings are comparable.",
  }),
});

export const aircraftRankingItemSchema = z.object({
  registration: z.string().openapi({ example: "D-AIZP" }),
  count: z.number().int(),
  airline: z.string().nullable(),
  aircraft: z.string().nullable(),
  totalDistanceKm: z.number(),
  firstFlightDate: z.string().nullable(),
  lastFlightDate: z.string().nullable(),
});

export const aircraftRankingResponseSchema = z.object({
  aircraft: z.array(aircraftRankingItemSchema),
  total: z.number().int().openapi({
    description:
      "How many distinct airframes are ranked — NOT the user's flight count. " +
      "Only flights carrying a registration appear here, so this is a count of " +
      "the rows above and nothing wider.",
  }),
});

export const aircraftProfileFlightSchema = z.object({
  id: z.string().uuid(),
  flightNumber: z.string().nullable(),
  airline: z.string().nullable(),
  depIata: z.string().nullable(),
  arrIata: z.string().nullable(),
  depName: z.string().nullable(),
  arrName: z.string().nullable(),
  departureTime: z.string().nullable(),
  arrivalTime: z.string().nullable(),
  distanceKm: z.number(),
  status: z.string(),
});

export const aircraftProfileResponseSchema = z.object({
  registration: z.string(),
  modeS: z.string().nullable(),
  airline: z.string().nullable(),
  aircraft: z.string().nullable(),
  flightCount: z.number().int(),
  totalDistanceKm: z.number(),
  firstFlightDate: z.string().nullable(),
  lastFlightDate: z.string().nullable(),
  uniqueAirports: z.number().int(),
  flights: z.array(aircraftProfileFlightSchema).openapi({
    description: "The user's flights on that airframe, newest first.",
  }),
});

export type AircraftTypeItem = z.infer<typeof aircraftTypeItemSchema>;
export type AircraftRankingItem = z.infer<typeof aircraftRankingItemSchema>;
export type AircraftTypesResponse = z.infer<typeof aircraftTypesResponseSchema>;
export type AircraftRankingResponse = z.infer<typeof aircraftRankingResponseSchema>;
export type AircraftProfileResponse = z.infer<typeof aircraftProfileResponseSchema>;
export type AircraftProfileFlight = z.infer<typeof aircraftProfileFlightSchema>;

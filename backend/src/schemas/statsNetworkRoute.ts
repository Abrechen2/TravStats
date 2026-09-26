import { z } from "./zod";

/**
 * `GET /stats/network/route/{a}/{b}` — the facts behind ONE arc of the globe
 * (forgejo#132 item 9).
 *
 * Described once, inferred by `services/stats/networkRoute.ts` and registered
 * for the spec by `services/openapi/paths/statsNetworkRoute.ts`, so the handler
 * and the spec cannot describe two different payloads (forgejo#52).
 */

/** An airport code as `/stats/network` names its nodes: IATA, or the row's own code. */
const nodeCode = z
  .string()
  .trim()
  .min(3)
  .max(4)
  .regex(/^[A-Za-z0-9]+$/)
  .transform((code) => code.toUpperCase());

export const networkRouteParamsSchema = z.object({
  a: nodeCode,
  b: nodeCode,
});

/** Page size ceiling: the route's own list is paged, never the whole history at once. */
export const NETWORK_ROUTE_MAX_LIMIT = 200;
export const NETWORK_ROUTE_DEFAULT_LIMIT = 50;

export const networkRouteQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NETWORK_ROUTE_MAX_LIMIT)
    .default(NETWORK_ROUTE_DEFAULT_LIMIT),
});

export const networkRouteFlightSchema = z.object({
  id: z.string(),
  flightNumber: z.string().nullable(),
  airline: z.string().nullable().describe("The airline as stored on the flight"),
  airlineIata: z.string().nullable(),
  depIata: z.string().nullable().describe("As stored — tells the direction the leg was flown"),
  arrIata: z.string().nullable(),
  date: z
    .string()
    .nullable()
    .describe(
      "YYYY-MM-DD on the DEPARTURE airport's calendar — the rule every " +
        "'when did I fly' figure uses. Null for a flight with no departure time."
    ),
  status: z.string().describe("flown or historical — the network counts nothing else"),
});

export const networkRouteDetailSchema = z.object({
  aIata: z.string().describe("The alphabetically smaller code of the pair"),
  bIata: z.string(),
  count: z
    .number()
    .int()
    .describe(
      "Flights on the pair, both directions — the same number /stats/network " +
        "gives this route, counted by the same pairing rule"
    ),
  airlines: z
    .array(
      z.object({
        key: z.string().describe("Airline identity as /stats/airlines groups it"),
        label: z.string(),
        iata: z.string().nullable(),
        count: z.number().int(),
      })
    )
    .describe("Distinct airlines on the route, most flown first"),
  airlineCount: z.number().int().describe("Distinct airlines; flights naming none are not one"),
  flightsWithoutAirline: z.number().int(),
  duration: z
    .object({
      averageMinutes: z
        .number()
        .nullable()
        .describe(
          "Mean over the flights that contributed a duration, measured or " +
            "estimated (shared/flightDuration.ts). Null when none did — never 0."
        ),
      measuredFlights: z.number().int(),
      estimatedFlights: z.number().int().describe("Durations estimated from the coordinates"),
    })
    .describe("How long the route takes, and how much of that is an estimate"),
  lastYear: z
    .number()
    .int()
    .nullable()
    .describe("Latest year flown, departure airport's calendar; null when no flight is dated"),
  flights: z.array(networkRouteFlightSchema).describe("Newest first, then by id; paged"),
  returned: z.number().int(),
  page: z.object({ offset: z.number().int(), limit: z.number().int() }),
});

export type NetworkRouteFlight = z.infer<typeof networkRouteFlightSchema>;
export type NetworkRouteDetail = z.infer<typeof networkRouteDetailSchema>;

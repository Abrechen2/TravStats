/**
 * GET /rail/stats (spec docs/superpowers/specs/2026-09-25-rail-domain.md,
 * phase 2b). Enveloped like the rest of the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { railStatsQuerySchema } from "../../../routes/rail/stats";

const ranked = z.array(z.object({ label: z.string(), count: z.number().int() }));

const punctualityRows = z.array(
  z.object({
    label: z.string(),
    measured: z.number().int().describe("Rides with a recorded delay and both clocks"),
    onTime: z.number().int().describe("Of those, arrived no later than scheduled"),
    averageMinutes: z.number().describe("Mean delay over the sample, early arrivals negative"),
  })
);

/** forgejo#261 — journeys, changes, connections, punctuality, nights on board. */
const railJourneyFigures = z
  .object({
    journeys: z.object({
      total: z
        .number()
        .int()
        .describe(
          "Rides read as journeys: legs of ONE booking that meet at a station within " +
            "four hours are one journey; a leg back to a station already left is a return " +
            "and starts a new one; rides not linked by a booking are never joined."
        ),
      withTransfer: z.number().int().describe("Journeys of two or more trains"),
    }),
    transfers: z.object({
      count: z.number().int().describe("Changes between trains of one journey, each measured"),
      averageMinutes: z.number().nullable(),
      shortestMinutes: z.number().nullable(),
      longestMinutes: z.number().nullable(),
    }),
    favouriteConnections: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          rides: z.number().int(),
          latestRideId: z.string().uuid(),
        })
      )
      .describe("Connections (both directions together) taken at least twice, top five"),
    newConnections: z.object({
      inScope: z
        .number()
        .int()
        .describe("Connections whose FIRST counted ride falls in the requested period"),
      byYear: z
        .array(z.object({ year: z.number().int(), count: z.number().int() }))
        .describe("Lifetime: connections per year of their first ride"),
    }),
    punctuality: z.object({
      byOperator: punctualityRows,
      byConnection: punctualityRows,
    }),
    nightTrainNights: z.object({
      nights: z.number().int().describe("Nights slept on board, on the stations' calendars"),
      undated: z.number().int().describe("Night trains whose arrival day is unknown"),
    }),
  })
  .describe("Journey-level figures over the same counted rides (forgejo#261)");

const railStats = registry.register(
  "RailStats",
  z
    .object({
      journeys: z.number().int().describe("Counted rides: status completed only"),
      distance: z
        .object({
          totalKm: z.number().describe("Every measured ride, whatever its source"),
          straightLineKm: z
            .number()
            .describe("great_circle — the straight line, which understates the track"),
          tracedKm: z.number().describe("route — along the traced Transitous line"),
          roadtripKm: z
            .number()
            .describe("roadtrip — along the line a converted roadtrip leg brought along"),
          ticketKm: z.number().describe("user — typed from the ticket"),
          unmeasuredJourneys: z.number().int().describe("Rides with no distance at all"),
        })
        .describe("Kilometres per source; never one undifferentiated figure"),
      hoursOnBoard: z.object({
        hours: z.number(),
        measuredJourneys: z.number().int().describe("Rides with both instants known"),
      }),
      countries: z.array(z.string()).describe("ISO 3166-1 alpha-2 of both stations, sorted"),
      operators: ranked,
      trainCategories: ranked,
      stations: ranked.describe("Departures plus arrivals per station, top ten"),
      longest: z
        .object({
          id: z.string().uuid(),
          depStationName: z.string(),
          arrStationName: z.string(),
          distanceKm: z.number(),
          distanceSource: z.string().nullable(),
        })
        .nullable(),
      delays: z.object({
        recordedJourneys: z
          .number()
          .int()
          .describe("Rides with a recorded delay; an unrecorded one is not on time"),
        buckets: z.array(
          z.object({ upToMinutes: z.number().int().nullable(), count: z.number().int() })
        ),
        averageMinutes: z
          .number()
          .nullable()
          .describe(
            "Mean delay over the recorded rides, one decimal, early arrivals negative. " +
              "Null when no ride carries a delay — never 0, which would claim on time."
          ),
      }),
      byYear: z.array(
        z.object({ year: z.number().int(), journeys: z.number().int(), km: z.number() })
      ),
      rideKinds: z
        .object({
          nightTrains: z.number().int(),
          highSpeed: z.number().int(),
          crossBorder: z.number().int().describe("Both stations' countries known and different"),
          operators: z.number().int().describe("Distinct operators, spelling folded"),
        })
        .describe("Rides of a kind, counted by the rule the rail badges use"),
      connected: railJourneyFigures,
    })
    .openapi("RailStats")
);

registry.registerPath({
  method: "get",
  path: "/rail/stats",
  summary: "Rail statistics",
  description:
    "Figures over the user's completed train rides. A ride's year is the year it " +
    "left in, on its departure station's calendar. Kilometres are reported per " +
    "source (straight line, traced line, ticket), hours and delays only over the " +
    "rides that carry them.",
  tags: ["Rail"],
  request: { query: railStatsQuerySchema },
  responses: {
    200: {
      description: "Rail statistics",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: railStats }) },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

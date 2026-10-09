/**
 * GET /bus/stats (spec docs/superpowers/specs/2026-10-07-bus-domain-design.md
 * §6, package B2; forgejo#263). Enveloped like the rest of the bus family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { busStatsQuerySchema } from "../../../routes/bus/stats";

const ranked = z.array(z.object({ label: z.string(), count: z.number().int() }));

const busStats = registry.register(
  "BusStats",
  z
    .object({
      rides: z.number().int().describe("Counted rides: status completed only"),
      distance: z
        .object({
          totalKm: z.number().describe("Every measured ride, whatever its source"),
          straightLineKm: z
            .number()
            .describe("great_circle — the straight line, which understates a road by 10–40 %"),
          routeKm: z.number().describe("route — along the routed road line"),
          ticketKm: z.number().describe("user — typed from the ticket"),
          unmeasuredRides: z.number().int().describe("Rides with no distance at all"),
        })
        .describe("Kilometres per source; never one undifferentiated figure"),
      hoursOnBoard: z.object({
        hours: z.number(),
        measuredRides: z.number().int().describe("Rides with both clocks known"),
      }),
      countries: z.array(z.string()).describe("ISO 3166-1 alpha-2 of both terminals, sorted"),
      operators: ranked.describe("Spelling folded, top ten"),
      rideKinds: ranked.describe("intercity | shuttle | other | unknown"),
      terminals: ranked.describe(
        "Departures plus arrivals per terminal, top ten. One terminal = within 1 km, or the " +
          "same name within 10 km"
      ),
      terminalsVisited: z.number().int().describe("Distinct terminals in the period"),
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
        recordedRides: z
          .number()
          .int()
          .describe(
            "Rides with a recorded delay and both clocks; an unrecorded one is not on time"
          ),
        buckets: z.array(
          z.object({ upToMinutes: z.number().int().nullable(), count: z.number().int() })
        ),
        averageMinutes: z.number().nullable().describe("Null when no ride carries a delay"),
      }),
      byYear: z.array(
        z.object({
          year: z.number().int(),
          rides: z.number().int(),
          km: z.number().nullable().describe("Null when no ride of the year has a distance"),
          unmeasured: z.number().int(),
        })
      ),
      journeys: z
        .object({ total: z.number().int(), withTransfer: z.number().int() })
        .describe("Rides of one booking that meet at a terminal within four hours are one journey"),
      transfers: z.object({
        count: z.number().int(),
        averageMinutes: z.number().nullable(),
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
        .describe("Both directions together, taken at least twice, top five"),
      newDestinations: z.object({
        inScope: z
          .number()
          .int()
          .describe("Terminals first ARRIVED at in the period that no earlier ride touched"),
        byYear: z.array(z.object({ year: z.number().int(), count: z.number().int() })),
      }),
      longestReturn: z
        .object({ days: z.number().int(), terminal: z.string() })
        .nullable()
        .describe("The longest wait before coming back to a terminal, lifetime"),
      night: z
        .object({ rides: z.number().int(), nights: z.number().int() })
        .describe("Rides whose clocks say they ran overnight (>= 6 h, a later arrival day)"),
    })
    .openapi("BusStats")
);

registry.registerPath({
  method: "get",
  path: "/bus/stats",
  summary: "Bus statistics",
  description:
    "Figures over the user's completed bus rides. A ride's year is the year it left in, on " +
    "its departure terminal's calendar. Kilometres are reported per source, hours and delays " +
    "only over the rides that carry them.",
  tags: ["Bus"],
  request: { query: busStatsQuerySchema },
  responses: {
    200: {
      description: "Bus statistics",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: busStats }) },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

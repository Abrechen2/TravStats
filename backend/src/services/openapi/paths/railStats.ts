/**
 * GET /rail/stats (spec docs/superpowers/specs/2026-09-25-rail-domain.md,
 * phase 2b). Enveloped like the rest of the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { railStatsQuerySchema } from "../../../routes/rail/stats";

const ranked = z.array(z.object({ label: z.string(), count: z.number().int() }));

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
      }),
      byYear: z.array(
        z.object({ year: z.number().int(), journeys: z.number().int(), km: z.number() })
      ),
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

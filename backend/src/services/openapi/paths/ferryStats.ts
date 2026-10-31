/** GET /ferry/stats (companion#85). Enveloped like the rest of the ferry family. */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { ferryStatsQuerySchema } from "../../../routes/ferry/stats";

const ranked = z.array(z.object({ label: z.string(), count: z.number().int() }));

const ferryStats = registry.register(
  "FerryStats",
  z
    .object({
      crossings: z.number().int().describe("Counted crossings: status completed only"),
      distance: z
        .object({
          totalKm: z.number().nullable().describe("Null when no crossing has a distance"),
          straightLineKm: z.number().nullable().describe("great_circle; null when none"),
          routeKm: z.number().nullable().describe("route; null when none"),
          ticketKm: z.number().nullable().describe("user, typed from the ticket; null when none"),
          unmeasuredCrossings: z.number().int().describe("Crossings with no distance at all"),
        })
        .describe("Kilometres per source; unknown is null, never 0"),
      hoursOnBoard: z.object({
        hours: z.number().nullable().describe("Null when no crossing has both clocks"),
        measuredCrossings: z.number().int(),
      }),
      countries: z.array(z.string()).describe("ISO 3166-1 alpha-2 of both ports, sorted"),
      operators: ranked.describe("Spelling folded, top ten"),
      ports: ranked.describe("Departures plus arrivals per port name, top ten"),
      portsVisited: z.number().int(),
      longest: z
        .object({
          id: z.string().uuid(),
          depStationName: z.string(),
          arrStationName: z.string(),
          distanceKm: z.number(),
          distanceSource: z.string().nullable(),
        })
        .nullable(),
      byYear: z.array(
        z.object({
          year: z.number().int(),
          crossings: z.number().int(),
          km: z.number().nullable().describe("Null when no crossing of the year has a distance"),
          unmeasured: z.number().int(),
        })
      ),
    })
    .openapi("FerryStats")
);

registry.registerPath({
  method: "get",
  path: "/ferry/stats",
  summary: "Ferry statistics",
  description:
    "Figures over the user's completed ferry crossings. A crossing's year is the year it left " +
    "in, on its departure port's calendar. Kilometres are reported per source; every figure " +
    "that cannot be derived is null, not 0.",
  tags: ["Ferry"],
  request: { query: ferryStatsQuerySchema },
  responses: {
    200: {
      description: "Ferry statistics",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: ferryStats }) },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

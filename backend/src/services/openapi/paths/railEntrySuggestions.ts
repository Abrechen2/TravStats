/**
 * GET /rail/entry-suggestions — the rail form's chips from the user's own
 * logbook. Enveloped like the rest of the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { RAIL_TRAVEL_CLASSES } from "../../../schemas/rail";

const railEntrySuggestions = registry.register(
  "RailEntrySuggestions",
  z
    .object({
      trains: z
        .array(z.object({ category: z.string().nullable(), number: z.string() }))
        .describe(
          "Trains ridden between the two stations (either direction), then with the operator"
        ),
      operators: z.array(z.string()).describe("The pair's operators first, then the user's"),
      travelClass: z
        .enum(RAIL_TRAVEL_CLASSES)
        .nullable()
        .describe("The class booked most often; null with no record"),
      coaches: z.array(z.string()),
      seats: z.array(z.string()),
    })
    .openapi("RailEntrySuggestions")
);

registry.registerPath({
  method: "get",
  path: "/rail/entry-suggestions",
  summary: "Rail form suggestions from the user's own journeys",
  description:
    "Values the rail form offers as one-click chips: trains ridden on the station " +
    "pair in either direction, operators, the usual class, coaches and seats. " +
    "Bounded and user-scoped; a chip fills a field only when clicked.",
  tags: ["Rail"],
  request: {
    query: z.object({
      depStationId: z.number().int().positive().optional().describe("Departure catalogue row"),
      arrStationId: z.number().int().positive().optional().describe("Arrival catalogue row"),
      depName: z.string().max(200).optional().describe("Departure station name"),
      arrName: z.string().max(200).optional().describe("Arrival station name"),
      operator: z.string().max(100).optional().describe("Operator, case-insensitive"),
    }),
  },
  responses: {
    200: {
      description: "Suggestions",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: railEntrySuggestions }),
        },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

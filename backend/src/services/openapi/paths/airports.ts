/**
 * Airport catalogue endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";
import { airportResponse } from "./shared";

registry.registerPath({
  method: "get",
  path: "/airports/search",
  summary: "Search airports",
  description:
    "Search by IATA/ICAO (exact match preferred) or by name/city (substring). " +
    "Use this to resolve coordinates before creating a flight via API.",
  tags: ["Airports"],
  request: {
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: "Matching airports",
      content: { "application/json": { schema: z.array(airportResponse) } },
    },
  },
});

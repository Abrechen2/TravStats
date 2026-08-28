/**
 * Companion endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const companionResponse = registry.register(
  "Companion",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      usageCount: z.number().int().describe("Flights + trips + cruises this companion is linked to"),
    })
    .openapi("Companion")
);

registry.registerPath({
  method: "get",
  path: "/companions",
  summary: "List your companions",
  description:
    "Returns the authenticated user's saved companions, most used first. " +
    "Feeds the companion picker in the flight, trip and cruise forms.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "Companions",
      content: {
        "application/json": {
          schema: z.object({ companions: z.array(companionResponse) }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

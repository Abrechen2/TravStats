/**
 * Companion and tag endpoints — the two vocabularies a user builds up across
 * every travel form.
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
      usageCount: z
        .number()
        .int()
        .describe("Flights + trips + cruises this companion is linked to"),
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

registry.registerPath({
  method: "get",
  path: "/tags",
  summary: "Tags you have used before",
  description:
    "The authenticated user's distinct tags across flights (special flights included), " +
    "trips and cruises, with how often each is used. Tags differing only in case are one " +
    "tag, shown in the spelling used most. Most used first, then by name. `q` keeps tags " +
    "containing it (case-insensitive). Feeds the tag input of those forms.",
  tags: ["Companions"],
  request: {
    query: z.object({
      q: z.string().max(100).optional().describe("Substring to match, case-insensitive"),
      limit: z.coerce.number().int().min(1).max(50).optional().describe("Default 20, max 50"),
    }),
  },
  responses: {
    200: {
      description: "Ranked tags; empty when nothing matches",
      content: {
        "application/json": {
          schema: z.object({
            tags: z.array(z.object({ name: z.string(), usageCount: z.number().int() })),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});

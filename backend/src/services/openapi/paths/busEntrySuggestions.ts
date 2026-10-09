/**
 * GET /bus/entry-suggestions — the bus form's chips from the user's own
 * logbook. Enveloped like the rest of the bus family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const busTerminalSuggestion = registry.register(
  "BusTerminalSuggestion",
  z
    .object({
      name: z.string(),
      address: z.string().nullable().describe("As printed on the ride it was taken from"),
      lat: z.number(),
      lon: z.number(),
      country: z.string().nullable().describe("ISO 3166-1 alpha-2; null when never stored"),
    })
    .openapi("BusTerminalSuggestion")
);

const busEntrySuggestions = registry.register(
  "BusEntrySuggestions",
  z
    .object({
      operators: z.array(z.string()).describe("The user's operators, most frequent first"),
      fareClasses: z
        .array(z.string())
        .describe("Fare classes used with the typed operator (all operators when none is typed)"),
      terminals: z
        .array(busTerminalSuggestion)
        .describe("Terminals starting with the typed name, either end, newest ride first"),
    })
    .openapi("BusEntrySuggestions")
);

registry.registerPath({
  method: "get",
  path: "/bus/entry-suggestions",
  summary: "Bus form suggestions from the user's own rides",
  description:
    "Values the bus form offers as one-click chips: operators, the fare classes used " +
    "with the typed operator, and terminals (name, position, country, address) read " +
    "from both ends of earlier rides. Bounded and user-scoped; a chip fills a field " +
    "only when clicked.",
  tags: ["Bus"],
  request: {
    query: z.object({
      depName: z.string().max(200).optional().describe("Departure terminal, typed so far"),
      arrName: z.string().max(200).optional().describe("Arrival terminal, typed so far"),
      operator: z.string().max(100).optional().describe("Operator, case-insensitive"),
    }),
  },
  responses: {
    200: {
      description: "Suggestions",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: busEntrySuggestions }),
        },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

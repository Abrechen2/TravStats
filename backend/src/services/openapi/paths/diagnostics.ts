/**
 * Instance diagnostics.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

registry.registerPath({
  method: "get",
  path: "/diagnostics",
  summary: "User-scoped data snapshot for bug reports",
  description:
    "Returns a redacted JSON snapshot of selected flights and trips so the " +
    "reporter can paste a reproducible state into a GitHub issue. Distinct " +
    "from `/diagnostic-export`, which returns server log tails. All filters " +
    "are optional and combined with AND. Sensitive fields (bookingReference, " +
    "ticketNumber, frequentFlyerNumber, price/taxes/fees, currency, " +
    "receiptUrl, coPassengers, companions, userId, notes) are replaced with " +
    "`null`; the response's `redacted` array advertises the exact list. " +
    "`recentErrors` is reserved for v1.5.x and currently always `[]`. " +
    "`read` scope is sufficient.",
  tags: ["Diagnostics"],
  request: {
    query: z.object({
      flightIds: z.string().optional().openapi({
        description: "Comma-separated UUIDs",
        example: "uuid1,uuid2",
      }),
      tripIds: z.string().optional().openapi({
        description: "Comma-separated UUIDs",
        example: "uuid1,uuid2",
      }),
      airline: z.string().optional().openapi({
        description: "Convenience filter equivalent to /flights?airline=…",
        example: "Iberia",
      }),
      since: z.string().datetime().optional().openapi({
        description: "ISO 8601 datetime — only flights/trips with updatedAt >= since",
        example: "2026-05-09T15:00:00Z",
      }),
    }),
  },
  responses: {
    200: {
      description: "Diagnostics bundle",
      content: {
        "application/json": {
          schema: z.object({
            generatedAt: z.string(),
            travstatsVersion: z.string(),
            schemaVersion: z.string(),
            redacted: z.array(z.string()),
            flights: z.array(z.record(z.unknown())),
            trips: z.array(z.record(z.unknown())),
            recentErrors: z.array(z.unknown()),
            filters: z.record(z.unknown()),
            counts: z.object({
              flights: z.number().int(),
              trips: z.number().int(),
            }),
          }),
        },
      },
    },
    401: { description: "Unauthenticated", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});

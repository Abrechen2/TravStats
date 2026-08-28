/**
 * Flight endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent, flightCreateInput, flightUpdateInput, flightResponse } from "./shared";

registry.registerPath({
  method: "get",
  path: "/flights",
  summary: "List flights",
  description:
    "Returns the authenticated user's flights, newest departure first. " +
    "Pagination via `limit` (default 50, max 500) and `offset`.",
  tags: ["Flights"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      status: z.string().optional().describe("Filter to a single flight status"),
      year: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of flights",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(flightResponse),
            total: z.number(),
          }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/flights/{id}",
  summary: "Get a single flight",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Flight",
      content: { "application/json": { schema: flightResponse } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/flights",
  summary: "Create a flight",
  description:
    "Creates a new flight. Pass `?merge=true` to enrich an existing matching " +
    "flight (same flightNumber + departureTime ± window) instead of creating " +
    "a duplicate row — empty fields on the existing flight are filled, " +
    "non-empty fields are preserved. Pass `?force=true` to skip duplicate " +
    "detection and always create.",
  tags: ["Flights"],
  request: {
    query: z.object({
      merge: z.enum(["true", "false"]).optional(),
      force: z.enum(["true", "false"]).optional(),
    }),
    body: {
      content: { "application/json": { schema: flightCreateInput } },
    },
  },
  responses: {
    201: {
      description: "Flight created",
      content: {
        "application/json": {
          schema: z.object({
            flight: flightResponse,
            mergedFields: z.array(z.string()).optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    409: {
      description: "Duplicate detected (omit `?force` or pass `?merge=true` to handle)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/flights/{id}",
  summary: "Update a flight",
  description:
    "Replaces the editable fields of an existing flight. Server-managed " +
    "fields (id, userId, createdAt, enrichmentHistory) are never accepted.",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: flightUpdateInput } } },
  },
  responses: {
    200: {
      description: "Flight updated",
      content: { "application/json": { schema: flightResponse } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/flights/{id}",
  summary: "Delete a flight",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

/**
 * Flight endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent, flightCreateInput, flightUpdateInput, flightResponse } from "./shared";
import { documentIdsBodySchema } from "../../../schemas/document";
import { FLIGHT_SORT_FIELDS } from "../../../schemas/flight";

registry.registerPath({
  method: "get",
  path: "/flights",
  summary: "List flights",
  description:
    "Returns the authenticated user's flights, newest departure first. " +
    "Pagination via `limit` (default 100, max 500) and `offset`; `total` is " +
    "the size of the FILTERED set, so a client can page without holding the " +
    "logbook. Every filter below narrows both.",
  tags: ["Flights"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      status: z.string().optional().describe("Filter to a single flight status"),
      year: z.coerce.number().int().optional().describe("Calendar year of the departure, in UTC"),
      month: z.coerce
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Calendar month of the departure (1-12), in UTC. Combinable with `year`."),
      q: z
        .string()
        .optional()
        .describe(
          "Free text, case-insensitive, OR'ed over flight number, airline name " +
            "and codes, both airport codes and both airport names."
        ),
      airline: z.string().optional().describe("Substring match on the airline name"),
      airlineExact: z
        .string()
        .optional()
        .describe("Exact airline name, as `/flights/facets` reports it"),
      tripId: z
        .string()
        .optional()
        .describe("A trip id, or `with` / `without` for any trip / no trip"),
      specialType: z
        .string()
        .optional()
        .describe(
          "One of the eight special-flight types, or `standard` (no type) / `special` (any type)"
        ),
      sort: z
        .enum(FLIGHT_SORT_FIELDS)
        .optional()
        .describe("Sort key; every key carries a tie-breaker, so the order is total"),
      order: z.enum(["asc", "desc"]).optional(),
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

const facetOption = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, count: z.number().int() });

registry.registerPath({
  method: "get",
  path: "/flights/facets",
  summary: "Filter options and headline figures for a flight list",
  description:
    "The year and airline option lists for the current filter set, each " +
    "counted under every OTHER filter but not its own (standard faceting), " +
    "plus the summary figures for the filtered set with ALL filters applied. " +
    "Takes the same query parameters as `GET /flights`; `limit`, `offset`, " +
    "`sort` and `order` are ignored. Lets a client page through the list " +
    "without holding it.",
  tags: ["Flights"],
  request: {
    query: z.object({
      q: z.string().optional(),
      year: z.coerce.number().int().optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      status: z.string().optional(),
      airline: z.string().optional(),
      airlineExact: z.string().optional(),
      tripId: z.string().optional(),
      specialType: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Facet option lists and summary figures",
      content: {
        "application/json": {
          schema: z.object({
            years: z.array(facetOption(z.number().int())),
            airlines: z.array(facetOption(z.string())),
            summary: z.object({
              flights: z.number().int(),
              airlines: z.number().int().describe("Distinct carriers by IATA identity"),
              airports: z.number().int().describe("Distinct IATA codes across both ends"),
              withoutAirline: z
                .number()
                .int()
                .describe("Flights naming no carrier, excluded from `airlines`"),
            }),
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
      content: { "application/json": { schema: flightCreateInput.and(documentIdsBodySchema) } },
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

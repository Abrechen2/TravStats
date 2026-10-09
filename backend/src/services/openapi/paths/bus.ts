/**
 * Bus ride endpoints (spec docs/superpowers/specs/2026-10-07-bus-domain-design.md).
 *
 * Enveloped like every newer domain (ADR 0001). The write body names terminals
 * as objects and times as the terminal's wall clock; the row that comes back is
 * flat and carries real UTC instants plus the zone each was read in.
 */

import { z } from "zod";

import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { errorContent, timeRefused } from "./shared";
import { documentIdsBodySchema } from "../../../schemas/document";
import {
  BUS_DISTANCE_SOURCES,
  BUS_GEOMETRY_SOURCES,
  BUS_RIDE_KINDS,
  BUS_SORT_FIELDS,
  BUS_STATUSES,
  createBusJourneySchema,
  updateBusJourneySchema,
} from "../../../schemas/bus";
import { busTimesSchema } from "../../../schemas/times";

const busJourney = registry.register(
  "BusJourney",
  z
    .object({
      ...prismaColumns("BusJourney"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      rideKind: z
        .enum(BUS_RIDE_KINDS)
        .nullable()
        .describe("intercity | shuttle | other; null when unstated"),
      depCountry: z.string().nullable().describe("ISO 3166-1 alpha-2; null when unknown"),
      depTimezone: z
        .string()
        .nullable()
        .describe("IANA zone, derived by the server from the terminal's coordinates"),
      arrTimezone: z.string().nullable(),
      departureTime: z.string().datetime().describe("Real UTC instant"),
      arrivalTime: z.string().datetime().nullable().describe("Real UTC instant, or unknown"),
      distanceKm: z.number().nullable(),
      distanceSource: z
        .enum(BUS_DISTANCE_SOURCES)
        .nullable()
        .describe(
          "great_circle = straight line between the terminals, not road length; " +
            "user = typed from the ticket; route = along the routed road line"
        ),
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .nullable()
        .describe("[lon, lat] points, frozen; null = the straight line"),
      geometrySource: z
        .enum(BUS_GEOMETRY_SOURCES)
        .describe(
          "Where the line comes from; a road-routed line may not be the road the coach took"
        ),
      actualDepartureTime: z.string().datetime().nullable(),
      actualArrivalTime: z.string().datetime().nullable(),
      status: z
        .enum(BUS_STATUSES)
        .describe("Derived from the two instants; only 'cancelled' is set by a client"),
      delayMinutes: z
        .number()
        .int()
        .nullable()
        .describe("Arrival delay; null = not recorded, 0 = on time"),
      trip: includedRow("trip (id, name, color)").nullable().optional(),
      times: busTimesSchema,
    })
    .openapi("BusJourney")
);

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

const busListSummarySchema = z
  .object({
    journeys: z.number().int(),
    operators: z.number().int(),
    withoutOperator: z.number().int(),
    stations: z.number().int(),
  })
  .describe("The summary strip's figures over the whole FILTERED set, not this page");

registry.registerPath({
  method: "get",
  path: "/bus",
  summary: "List bus rides",
  description:
    "One page of the authenticated user's coach rides. `meta.total` is the size of " +
    "the FILTERED set. Every sort key carries `id` as a tie-breaker, so paging is stable.",
  tags: ["Bus"],
  request: {
    query: z.object({
      status: z.enum(BUS_STATUSES).optional(),
      q: z
        .string()
        .optional()
        .describe(
          "Free text over operator, line name, both terminal names and the booking reference"
        ),
      year: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2200)
        .optional()
        .describe("Calendar year of the departure, on the departure terminal's calendar"),
      tripId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sort: z.enum(BUS_SORT_FIELDS).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of bus rides",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(busJourney),
            meta: z.object({
              total: z.number().int().describe("Size of the FILTERED set"),
              summary: busListSummarySchema,
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          }),
        },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/bus/{id}",
  summary: "Get a bus ride",
  tags: ["Bus"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Bus ride",
      content: { "application/json": { schema: envelope(busJourney) } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/bus",
  summary: "Create a bus ride",
  description:
    "`departureLocal`/`arrivalLocal` are the terminal's wall clock without an offset; " +
    "the server looks up each terminal's zone from its coordinates and stores the " +
    "real instant. A ticket that prints no time is sent as the day alone " +
    "(`YYYY-MM-DD`): stored as the start of that day at the terminal with precision " +
    "`day`, it has no duration and no delay (`delayMinutes` is refused). Without " +
    "`distanceKm` the great-circle distance is stored and labelled `great_circle` — a " +
    "straight line, not the road.",
  tags: ["Bus"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createBusJourneySchema
            .openapi("BusJourneyCreateInput")
            .and(documentIdsBodySchema),
        },
      },
    },
  },
  responses: {
    422: timeRefused,
    201: {
      description: "Created",
      content: { "application/json": { schema: envelope(busJourney) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Trip or booking not found", content: errorContent },
    429: { description: "Too many rides created", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/bus/{id}",
  summary: "Update a bus ride",
  description:
    "Partial update. A terminal is replaced whole. The wall clock not sent is kept " +
    "and re-read in the (possibly new) terminal zone. `distanceKm: null` returns to " +
    "the measured distance.",
  tags: ["Bus"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: updateBusJourneySchema.openapi("BusJourneyUpdateInput") },
      },
    },
  },
  responses: {
    422: timeRefused,
    200: {
      description: "Updated",
      content: { "application/json": { schema: envelope(busJourney) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/bus/{id}",
  summary: "Delete a bus ride",
  tags: ["Bus"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

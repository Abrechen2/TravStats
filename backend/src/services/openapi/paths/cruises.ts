/**
 * Cruise endpoints.
 *
 * Every response here is the `{ success, data }` envelope the cruise
 * routers use — deliberately unlike the bare arrays the older flight
 * endpoints return. Documenting the difference is the point: a consumer
 * that assumes one shape for the whole API breaks on the other.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  createCruiseSchema,
  updateCruiseSchema,
  routeOverrideSchema,
  routeOverrideKeySchema,
} from "../../../schemas/cruise";

const cruiseStop = registry.register(
  "CruiseStop",
  z
    .object({
      id: z.string().uuid(),
      dayNumber: z.number().int().min(1).describe("1-based, always renumbered to match order"),
      portId: z.number().int().nullable(),
      isAtSea: z.boolean(),
      unresolvedPortName: z
        .string()
        .nullable()
        .describe("Imported port name that could not be matched to the catalogue"),
      date: z.string().datetime().nullable(),
      arrivalTime: z.string().datetime().nullable(),
      departureTime: z.string().datetime().nullable(),
      excursionNote: z.string().nullable(),
    })
    .describe(
      "A stop is exactly one of three states: a matched port (portId set, " +
        "isAtSea false, unresolvedPortName null), a sea day (isAtSea true, the " +
        "other two empty), or an unresolved port (unresolvedPortName set, " +
        "portId null, isAtSea false). Any other combination is rejected. An " +
        "unresolved stop counts as a port call but has no coordinates, so it is " +
        "excluded from legs, distance and the map."
    )
    .openapi("CruiseStop")
);

const cruise = registry.register(
  "Cruise",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      shipId: z.number().int().nullable(),
      shipNameOverride: z.string().nullable(),
      cruiseLine: z.string().nullable(),
      routeName: z.string().nullable().describe("Itinerary name from the booking, e.g. 'Kanaren mit Marokko'"),
      departurePortId: z.number().int().nullable(),
      arrivalPortId: z.number().int().nullable(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      status: z.enum(["scheduled", "flown", "cancelled", "historical"]),
      cabinNumber: z.string().nullable(),
      cabinType: z.enum(["inside", "oceanview", "balcony", "suite"]).nullable(),
      deck: z.number().int().nullable(),
      bookingReference: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      notes: z.string().nullable(),
      tags: z.array(z.string()),
      companions: z.array(z.string()),
      tripId: z.string().uuid().nullable(),
      bookingId: z.string().uuid().nullable(),
      color: z.string().nullable().describe("User-chosen map colour; null falls back to the auto-derived one"),
      stops: z.array(cruiseStop).optional(),
      createdAt: z.string().datetime(),
    })
    .openapi("Cruise")
);

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

registry.registerPath({
  method: "get",
  path: "/cruises",
  summary: "List cruises",
  description:
    "Returns the authenticated user's cruises. `status` and `cruiseLine` accept " +
    "either a single value or a repeated query parameter.",
  tags: ["Cruises"],
  request: {
    query: z.object({
      status: z.enum(["scheduled", "flown", "cancelled", "historical"]).optional(),
      cruiseLine: z.string().optional(),
      year: z.coerce.number().int().min(1900).max(2200).optional(),
      region: z.string().optional(),
      tripId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sort: z.enum(["date", "ship", "line", "ports", "status"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Cruises",
      content: { "application/json": { schema: envelope(z.array(cruise)) } },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/cruises/{id}",
  summary: "Get a cruise",
  tags: ["Cruises"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Cruise", content: { "application/json": { schema: envelope(cruise) } } },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/cruises",
  summary: "Create a cruise",
  description:
    "Stops are optional on create and validated against the three-state rule " +
    "described on CruiseStop. Passing `importBatchId` marks the row as imported " +
    "and lets the server derive the provenance key itself.",
  tags: ["Cruises"],
  request: {
    body: { content: { "application/json": { schema: createCruiseSchema.openapi("CruiseCreateInput") } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelope(cruise) } } },
    400: { description: "Validation failed", content: errorContent },
    409: { description: "A cruise from the same import already exists", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/cruises/{id}",
  summary: "Update a cruise",
  description:
    "Partial update. Omitting a field leaves it unchanged; sending `null` or an " +
    "empty string clears it. Sending `stops` replaces the whole itinerary.",
  tags: ["Cruises"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: updateCruiseSchema.openapi("CruiseUpdateInput") } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: envelope(cruise) } } },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/cruises/{id}",
  summary: "Delete a cruise",
  tags: ["Cruises"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

/* ─────────────────────────── sea route geometry ─────────────────────── */

const geometry = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.tuple([z.number(), z.number()])),
        }),
        properties: z.record(z.unknown()),
      })
    ),
  })
  .describe(
    "GeoJSON, coordinates in [lon, lat] order. One feature per leg between " +
      "consecutive coordinate-bearing stops. Legs the shipping-lane router " +
      "cannot solve fall back to a straight chord between the two ports."
  );

registry.registerPath({
  method: "get",
  path: "/cruises/{id}/geometry",
  summary: "Sea route geometry for one cruise",
  description:
    "Waypoints per leg, produced by the in-house marnet shipping-lane router. " +
    "Clients are expected to draw a spline through them rather than connecting " +
    "them with straight segments.",
  tags: ["Cruises"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Route geometry", content: { "application/json": { schema: envelope(geometry) } } },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/cruises/geometry/batch",
  summary: "Sea route geometry for several cruises",
  description: "Same payload as the per-cruise endpoint, keyed by cruise id — one round trip for a map view.",
  tags: ["Cruises"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Geometry per cruise id",
      content: { "application/json": { schema: envelope(z.record(geometry)) } },
    },
    400: { description: "Validation failed", content: errorContent },
  },
});

/* ──────────────────────────── route overrides ───────────────────────── */

registry.registerPath({
  method: "put",
  path: "/cruises/{id}/route-override",
  summary: "Hand-correct one leg of a sea route",
  description:
    "Replaces the router's waypoints for a single port-to-port leg. Idempotent: " +
    "200 when an existing override was replaced, 201 when a new one was stored.",
  tags: ["Cruises"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: routeOverrideSchema.openapi("CruiseRouteOverride") } } },
  },
  responses: {
    200: { description: "Override replaced" },
    201: { description: "Override created" },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Cruise not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/cruises/{id}/route-override",
  summary: "Drop a hand-corrected leg",
  description: "Removes the override so the leg falls back to the routed line.",
  tags: ["Cruises"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: routeOverrideKeySchema,
  },
  responses: {
    200: {
      description: "Number of overrides removed",
      content: {
        "application/json": {
          schema: envelope(z.object({ deleted: z.number().int() })),
        },
      },
    },
    404: { description: "Cruise not found", content: errorContent },
  },
});

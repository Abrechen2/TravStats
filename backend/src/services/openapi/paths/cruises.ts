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
import { includedRow, prismaColumns } from "../prismaColumns";
import { documentIdsBodySchema } from "../../../schemas/document";
import { errorContent } from "./shared";
import { CRUISE_QUERY_STATUSES } from "../../../schemas/cruise";
import { CRUISE_SORT_FIELDS } from "../../../shared/cruiseListOrder";
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
      ...prismaColumns("CruiseStop"),
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
      port: includedRow("port").nullable().optional(),
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
      ...prismaColumns("Cruise"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      shipId: z.number().int().nullable(),
      shipNameOverride: z.string().nullable(),
      cruiseLine: z.string().nullable(),
      routeName: z
        .string()
        .nullable()
        .describe("Itinerary name from the booking, e.g. 'Kanaren mit Marokko'"),
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
      color: z
        .string()
        .nullable()
        .describe("User-chosen map colour; null falls back to the auto-derived one"),
      stops: z.array(cruiseStop).optional(),
      ship: includedRow("ship").nullable().optional(),
      departurePort: includedRow("port").nullable().optional(),
      arrivalPort: includedRow("port").nullable().optional(),
      trip: includedRow("trip (id, name, color)").nullable().optional(),
      legs: z.array(includedRow("leg")).optional(),
      createdAt: z.string().datetime(),
    })
    .openapi("Cruise")
);

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

/** The same envelope, carrying the page a list answered from. */
const pagedEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z.object({
      total: z.number().int().describe("Size of the FILTERED set, before the page slice"),
      limit: z.number().int(),
      offset: z.number().int(),
    }),
  });

registry.registerPath({
  method: "get",
  path: "/cruises",
  summary: "List cruises",
  description:
    "Returns one page of the authenticated user's cruises. `status` and " +
    "`cruiseLine` accept either a single value or a repeated query parameter. " +
    "`meta.total` is the size of the FILTERED set, so a client can page " +
    "without holding the logbook; it is always present.",
  tags: ["Cruises"],
  request: {
    query: z.object({
      status: z.enum(CRUISE_QUERY_STATUSES).optional(),
      cruiseLine: z.string().optional().describe("Exact match on the cruise_line column"),
      shipLine: z
        .string()
        .optional()
        .describe("The line a cruise belongs to — its own, or its ship's when it has none"),
      q: z
        .string()
        .optional()
        .describe(
          "Free text, case-insensitive, OR'ed over ship, line, route name, booking " +
            "reference and the names of the departure, arrival and called-at ports."
        ),
      year: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2200)
        .optional()
        .describe("Calendar year of the sailing's start, read in UTC"),
      month: z.coerce
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Calendar month of the sailing's start (1-12), in UTC. Combinable with `year`."),
      region: z.string().optional(),
      tripId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sort: z
        .enum(CRUISE_SORT_FIELDS)
        .optional()
        .describe("Sort key; every key carries a tie-breaker, so the order is total"),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of cruises",
      content: { "application/json": { schema: pagedEnvelope(z.array(cruise)) } },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

const facetOption = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, count: z.number().int() });

registry.registerPath({
  method: "get",
  path: "/cruises/facets",
  summary: "Filter options and headline figures for a cruise list",
  description:
    "The year and line option lists for the current filter set, each counted " +
    "under every OTHER filter but not its own (standard faceting), plus the " +
    "summary figures for the filtered set with ALL filters applied. Takes the " +
    "same query parameters as `GET /cruises`; `limit`, `offset`, `sort` and " +
    "`order` are ignored. Lets a client page through the list without holding it.",
  tags: ["Cruises"],
  request: {
    query: z.object({
      q: z.string().optional(),
      year: z.coerce.number().int().min(1900).max(2200).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      status: z.enum(CRUISE_QUERY_STATUSES).optional(),
      cruiseLine: z.string().optional(),
      shipLine: z.string().optional(),
      region: z.string().optional(),
      tripId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "Facet option lists and summary figures",
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              years: z.array(facetOption(z.number().int())),
              lines: z.array(facetOption(z.string())),
              summary: z.object({
                cruises: z.number().int(),
                portCalls: z
                  .number()
                  .int()
                  .describe("How many times a ship tied up; sea days excluded"),
                seaDays: z.number().int(),
                lines: z.number().int().describe("Distinct lines, a cruise's own or its ship's"),
              }),
            })
          ),
        },
      },
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
    body: {
      content: {
        "application/json": {
          schema: createCruiseSchema.openapi("CruiseCreateInput").and(documentIdsBodySchema),
        },
      },
    },
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
    body: {
      content: { "application/json": { schema: updateCruiseSchema.openapi("CruiseUpdateInput") } },
    },
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
        properties: z.record(z.string(), z.unknown()),
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
    200: {
      description: "Route geometry",
      content: { "application/json": { schema: envelope(geometry) } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/cruises/geometry/batch",
  summary: "Sea route geometry for several cruises",
  description:
    "Same payload as the per-cruise endpoint, keyed by cruise id — one round trip for a map view.",
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
      content: { "application/json": { schema: envelope(z.record(z.string(), geometry)) } },
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
    body: {
      content: {
        "application/json": { schema: routeOverrideSchema.openapi("CruiseRouteOverride") },
      },
    },
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

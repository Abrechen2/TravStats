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
import { clientRefBodySchema } from "../../../schemas/clientRef";
import { clientRefResponses } from "./clientRef";
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
import { ROUTE_FALLBACK_REASONS } from "../../tour/routing/types";

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

/** What a save did to the frozen road line — beside the row, so the row stays the row. */
const geometryReport = z
  .object({
    outcome: z
      .enum(["unchanged", "routed", "straight", "kept"])
      .describe(
        "unchanged = nothing the line depends on moved (or the ride already had its line); " +
          "routed = a road line was fetched and frozen; straight = the chord was stored " +
          "because no road line came back; kept = a re-fetch failed and the frozen road " +
          "line stayed"
      ),
    geometrySource: z.enum(BUS_GEOMETRY_SOURCES),
    fallback: z
      .enum(ROUTE_FALLBACK_REASONS)
      .nullable()
      .describe(
        "Why no road line was delivered: no_provider (the instance has no routing " +
          "provider), provider_error (network, 5xx, unreadable answer or timeout), no_route, " +
          "point_not_near_road, rate_limited, auth, untrustworthy; null when nothing asked for failed"
      ),
  })
  .openapi("BusGeometryReport");

const writeEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data, meta: z.object({ geometry: geometryReport }) });

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
    "straight line, not the road. The road line is fetched ONCE from the instance's routing " +
    "provider, with a short timeout, and frozen: `geometrySource: road`, `distanceKm` its " +
    "routed length, `distanceSource: route` (a typed `distanceKm` stays `user`). When no " +
    "road line comes back the chord is stored and `meta.geometry.fallback` says why.",
  tags: ["Bus"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createBusJourneySchema
            .openapi("BusJourneyCreateInput")
            .and(documentIdsBodySchema)
            .and(clientRefBodySchema),
        },
      },
    },
  },
  responses: {
    422: timeRefused,
    201: {
      description: "Created",
      content: { "application/json": { schema: writeEnvelope(busJourney) } },
    },
    ...clientRefResponses({ "application/json": { schema: writeEnvelope(busJourney) } }),
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
    "the measured distance. The road line is fetched again ONLY when a terminal's " +
    "coordinates changed; a failed re-fetch keeps the frozen road line while it still " +
    "reaches both terminals (`meta.geometry.outcome: kept`).",
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
      content: { "application/json": { schema: writeEnvelope(busJourney) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/bus/routing",
  summary: "Does this instance have a road routing provider?",
  description:
    "Whether rides can get a road line at all, and which provider answers. Never leaks a key " +
    "or a URL. Without a provider every ride stays a straight line until an admin sets one " +
    "up under Admin → External services.",
  tags: ["Bus"],
  responses: {
    200: {
      description: "Routing availability",
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              configured: z.boolean(),
              providerId: z.enum(["openrouteservice", "graphhopper", "custom"]).nullable(),
            })
          ),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/bus/{id}/route",
  summary: "Route a straight ride along the road",
  description:
    '"Route again" for a ride logged before routing existed (or while the provider was down). ' +
    "Only a ride whose `geometrySource` is `straight` is routed; any other answers " +
    "`meta.geometry.outcome: unchanged` without a provider call, so repeating the request is " +
    "harmless. A provider that does not deliver answers 200 with `outcome: straight` and its " +
    "reason in `fallback`. A typed ticket distance is kept. Rate-limited; the shared demo " +
    "account is refused.",
  tags: ["Bus"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The ride and what routing did to its line",
      content: { "application/json": { schema: writeEnvelope(busJourney) } },
    },
    403: { description: "The shared demo account may not route", content: errorContent },
    404: { description: "Not found", content: errorContent },
    429: { description: "Too many routing requests", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/bus/route-straight",
  summary: "Route every straight ride along the road (background job)",
  description:
    "Starts a background job (kind `bus.routeStraight`, poll `GET /jobs/{id}`) that routes up " +
    "to 200 of the caller's straight rides, newest first, one provider call each. The job's " +
    "`result` lists every ride's outcome with the provider's reason; the pass stops early on " +
    "`rate_limited` or `auth` (`stoppedBy`) and reports what is `remaining`. While a pass " +
    "runs, asking again answers the same job. 409 `BUS_NO_ROUTING_PROVIDER` when the " +
    "instance has no provider. Rate-limited; the shared demo account is refused.",
  tags: ["Bus"],
  responses: {
    202: {
      description: "The job to poll",
      content: { "application/json": { schema: envelope(z.object({ jobId: z.string().uuid() })) } },
    },
    403: { description: "The shared demo account may not route", content: errorContent },
    409: { description: "BUS_NO_ROUTING_PROVIDER", content: errorContent },
    429: { description: "Too many routing requests", content: errorContent },
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

const ticketProposal = z.record(z.string(), z.object({ value: z.string(), evidence: z.string() }));

registry.registerPath({
  method: "post",
  path: "/bus/ticket-preview",
  summary: "Preview coach ticket values without creating a ride",
  description:
    "Reads an uploaded document (`documentId`) or pasted text with the `bus` templates — the " +
    "template repository's, then the caller's own ACTIVE workshop templates (forgejo#309). " +
    "Template or decline: there is no model path. One proposal per ride, keyed by " +
    "`departureStop`, `arrivalStop`, `departureLocal`, `arrivalLocal` (the stop's own wall " +
    "clock), `operator`, `lineName`, `bookingReference`, `price`, `currency`. `reason` says why " +
    "nothing was read: `noText`, `noTemplate` (no template claims the ticket) or `nothingRead` " +
    "(one claimed it but read no complete ride). Nothing is saved.",
  tags: ["Bus"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.union([
            z.object({ documentId: z.string().uuid() }),
            z.object({ text: z.string().min(1).max(60000) }),
          ]),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Template proposals for user review",
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              rides: z.array(ticketProposal),
              parser: z.literal("template").nullable(),
              reason: z.enum(["noText", "noTemplate", "nothingRead"]).nullable(),
              template: z
                .object({ id: z.string(), source: z.enum(["workshop", "repository"]) })
                .nullable(),
            })
          ),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    403: { description: "The shared demo account may not import", content: errorContent },
    415: { description: "Document format not supported", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

/**
 * Rail journey endpoints (spec docs/superpowers/specs/2026-09-25-rail-domain.md).
 *
 * Enveloped like every newer domain (ADR 0001). The write body names stations
 * as objects and times as the station's wall clock; the row that comes back is
 * flat and carries real UTC instants plus the zone each was read in.
 */

import { z } from "zod";

import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { errorContent, timeRefused } from "./shared";
import { documentIdsBodySchema } from "../../../schemas/document";
import {
  createRailJourneySchema,
  updateRailJourneySchema,
  RAIL_DISTANCE_SOURCES,
  RAIL_GEOMETRY_FALLBACK_REASONS,
  RAIL_GEOMETRY_SOURCES,
  RAIL_SORT_FIELDS,
  RAIL_STATUSES,
  RAIL_TRAVEL_CLASSES,
} from "../../../schemas/rail";
import { railTimesSchema } from "../../../schemas/times";
import { railConnectionQuerySchema } from "../../../routes/rail/connections";

/** Where a ride came from, read from its filed originals (forgejo#132 item 17). */
const railSource = z
  .object({
    kind: z.literal("document"),
    documentId: z.string().uuid(),
    documentKind: z
      .string()
      .nullable()
      .describe("invoice | booking | boardingPass | ticket | other; null when unstated"),
    format: z.string().describe("The file: image | pdf | eml | emailText | pkpass"),
    name: z.string().nullable().describe("The file name the user handed over, sanitised"),
    issuedOn: z.string().nullable().describe("The date printed on the document, YYYY-MM-DD"),
    parsed: z
      .boolean()
      .describe("True when the ride was parsed from this document, not filed with it later"),
    documentCount: z.number().int().min(1).describe("Originals filed with the ride"),
  })
  .nullable()
  .openapi("RailSource", {
    description:
      "The original the ride came from — the parsed one first, else the oldest filed. " +
      "Never set by a client: it is read from the documents linked to the ride " +
      "(`documentIds` on create, or filing later). Null when no original was kept.",
  });

const railJourney = registry.register(
  "RailJourney",
  z
    .object({
      ...prismaColumns("RailJourney"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      trainCategory: z.string().nullable().describe("'ICE', 'TGV', 'RJX' — grouped by statistics"),
      depStationCode: z.string().nullable().describe("UIC code when known"),
      depStationId: z
        .number()
        .int()
        .nullable()
        .describe(
          "Catalogue row (GET /rail/stations) the station was picked from; null = geocoder"
        ),
      arrStationId: z.number().int().nullable(),
      depStationShortCode: z
        .string()
        .nullable()
        .describe(
          "DB station code of the catalogue row (Ril 100, 'KK'); null for a geocoder pick " +
            "or a station no source names — never derived"
        ),
      arrStationShortCode: z.string().nullable(),
      depCountry: z.string().nullable().describe("ISO 3166-1 alpha-2; null when unknown"),
      depTimezone: z
        .string()
        .nullable()
        .describe("IANA zone, derived by the server from the station's coordinates"),
      arrTimezone: z.string().nullable(),
      departureTime: z.string().datetime().describe("Real UTC instant"),
      arrivalTime: z.string().datetime().nullable().describe("Real UTC instant, or unknown"),
      distanceKm: z.number().nullable(),
      distanceSource: z
        .enum(RAIL_DISTANCE_SOURCES)
        .nullable()
        .describe(
          "great_circle = straight line between the stations, not track length; " +
            "user = typed from the ticket; route = length of the traced Transitous line or " +
            "of the line routed over the tracks; " +
            "roadtrip = length of the line a converted roadtrip leg brought along"
        ),
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .nullable()
        .describe(
          "[lon, lat] points, fetched once when the journey was logged and frozen with it; " +
            "null = the straight line between the stations"
        ),
      geometrySource: z
        .enum(RAIL_GEOMETRY_SOURCES)
        .describe("Where the line comes from; a track-routed line may not be the train's path"),
      actualDepartureTime: z
        .string()
        .datetime()
        .nullable()
        .describe("What happened, when known; null for a past journey nobody recorded"),
      actualArrivalTime: z.string().datetime().nullable(),
      lookupProvider: z
        .string()
        .nullable()
        .describe("Timetable source a lookup matched (phase 2); null for a hand-entered journey"),
      travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable(),
      status: z
        .enum(RAIL_STATUSES)
        .describe("Derived from the two instants; only 'cancelled' is set by a client"),
      delayMinutes: z
        .number()
        .int()
        .nullable()
        .describe("Arrival delay; null = not recorded, 0 = on time"),
      tightConnection: z
        .boolean()
        .describe(
          "The user's own mark that the change AFTER this train is tight; set on the " +
            "leg that arrives at the change. Never derived"
        ),
      trip: includedRow("trip (id, name, color)").nullable().optional(),
      times: railTimesSchema,
      source: railSource,
    })
    .openapi("RailJourney")
);

/** A leg of the same booking, as the detail read lists it. */
const railBookingLeg = z.object({
  id: z.string().uuid(),
  depStationName: z.string(),
  arrStationName: z.string(),
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime().nullable(),
  depTimezone: z.string().nullable(),
  arrTimezone: z.string().nullable(),
  depPrecision: z.string().nullable(),
  arrPrecision: z.string().nullable(),
  actualDepartureTime: z.string().datetime().nullable(),
  actualArrivalTime: z.string().datetime().nullable(),
  trainCategory: z.string().nullable(),
  trainNumber: z.string().nullable(),
  status: z.enum(RAIL_STATUSES),
  depStationId: z.number().int().nullable(),
  arrStationId: z.number().int().nullable(),
  travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable(),
  coach: z.string().nullable(),
  seat: z.string().nullable(),
  bookingReference: z.string().nullable(),
  tightConnection: z.boolean().describe("The user's mark that the change after this leg is tight"),
  times: railTimesSchema,
});

const railJourneyDetail = railJourney
  .extend({
    booking: z
      .object({
        id: z.string().uuid(),
        pnr: z.string().nullable(),
        railJourneys: z
          .array(railBookingLeg)
          .describe("Every rail leg of the booking, this one included, in departure order"),
      })
      .nullable()
      .describe("The booking that binds a connection's legs; null for a single ride"),
  })
  .openapi("RailJourneyDetail");

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

/** What a save did to the frozen line — beside the row, so the row stays the row. */
const geometryReport = z
  .object({
    outcome: z
      .enum(["unchanged", "traced", "routed", "straight", "kept"])
      .describe(
        "unchanged = an edit that touched neither station nor match; traced = the train's " +
          "Transitous trace; routed = a line over the tracks from the instance's " +
          "OpenRailRouting; kept = a re-fetch did not deliver and the frozen line stayed"
      ),
    geometrySource: z.enum(RAIL_GEOMETRY_SOURCES),
    fallback: z
      .enum(RAIL_GEOMETRY_FALLBACK_REASONS)
      .nullable()
      .describe(
        "Why the line asked for was not delivered — a Transitous trace, or the " +
          "OpenRailRouting line (`railRouting*`); null when nothing asked for failed"
      ),
  })
  .openapi("RailGeometryReport");

const writeEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z.object({ geometry: geometryReport }),
  });

const railListSummarySchema = z
  .object({
    journeys: z.number().int(),
    operators: z.number().int(),
    withoutOperator: z.number().int(),
    stations: z.number().int(),
  })
  .describe("The summary strip's figures over the whole FILTERED set, not this page");

registry.registerPath({
  method: "get",
  path: "/rail",
  summary: "List rail journeys",
  description:
    "One page of the authenticated user's train rides. `meta.total` is the size of " +
    "the FILTERED set. Every sort key carries `id` as a tie-breaker, so paging is stable.",
  tags: ["Rail"],
  request: {
    query: z.object({
      status: z.enum(RAIL_STATUSES).optional(),
      q: z
        .string()
        .optional()
        .describe(
          "Free text over operator, train category and number, both station names " +
            "and the booking reference"
        ),
      year: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2200)
        .optional()
        .describe("Calendar year of the departure, on the departure station's calendar"),
      tripId: z.string().uuid().optional(),
      membershipId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "A rail loyalty card: only the rides it counts. 404 LOYALTY_MEMBERSHIP_NOT_FOUND " +
            "for a card that is not the caller's rail card"
        ),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sort: z.enum(RAIL_SORT_FIELDS).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of rail journeys",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(railJourney),
            meta: z.object({
              total: z.number().int().describe("Size of the FILTERED set"),
              summary: railListSummarySchema,
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
  path: "/rail/{id}",
  summary: "Get a rail journey",
  tags: ["Rail"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Rail journey with its booking's legs",
      content: { "application/json": { schema: envelope(railJourneyDetail) } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/rail",
  summary: "Create a rail journey",
  description:
    "`departureLocal`/`arrivalLocal` are the station's wall clock without an offset; " +
    "the server looks up each station's zone from its coordinates and stores the " +
    "real instant. A ticket that prints no time is sent as the day alone " +
    "(`YYYY-MM-DD`): stored as the start of that day at the station with precision " +
    "`day`, it has no duration, no delay (`delayMinutes` is refused) and is no " +
    "night train by the clock. A station with `stationId` takes position, code and country from " +
    "the catalogue. With `lookup` of provider `transitous` the server fetches that " +
    "trip's traced line once, cuts it to the two stations and freezes it " +
    "(`geometrySource: transitous`, distance along it); a missing, unreachable or " +
    "chord-only line stores `straight` and `meta.geometry.fallback` says why. Without a " +
    "trace, and only where the admin configured an OpenRailRouting, the line is routed " +
    "over the tracks between the stations in one request (`geometrySource: " +
    "openrailrouting`); its failure stores `straight` with a `railRouting*` fallback. " +
    "Without `distanceKm` the traced or routed, else the " +
    "great-circle distance is stored. `connectsFrom` names the leg this one continues: " +
    "the server binds both through a booking (creating one on that leg when it has " +
    "none) and files the new leg in that leg's trip unless `tripId` is sent.",
  tags: ["Rail"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createRailJourneySchema
            .openapi("RailJourneyCreateInput")
            .and(documentIdsBodySchema),
        },
      },
    },
  },
  responses: {
    422: timeRefused,
    201: {
      description: "Created",
      content: { "application/json": { schema: writeEnvelope(railJourney) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Trip or booking not found", content: errorContent },
    429: { description: "Too many journeys created", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/rail/{id}",
  summary: "Update a rail journey",
  description:
    "Partial update. A station is replaced whole. The wall clock not sent is kept " +
    "and re-read in the (possibly new) station zone. `distanceKm: null` returns to " +
    "the measured distance. The frozen line is fetched again only when a station's " +
    "coordinates or the `lookup` identity differ from the stored row; `lookup: null` " +
    "drops it. A re-fetch that does not deliver keeps the stored line where it still " +
    "runs between the stations (`meta.geometry.outcome: kept`).",
  tags: ["Rail"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: updateRailJourneySchema.openapi("RailJourneyUpdateInput") },
      },
    },
  },
  responses: {
    422: timeRefused,
    200: {
      description: "Updated",
      content: { "application/json": { schema: writeEnvelope(railJourney) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/rail/{id}",
  summary: "Delete a rail journey",
  tags: ["Rail"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

/** A ride as one entry: its legs in travel order (forgejo#187). */
const railConnection = z.object({
  id: z.string().uuid().describe("The first leg's id — any leg's id finds the connection"),
  legs: z.array(railJourney).min(1).describe("The trains of the ride, in travel order"),
});

registry.registerPath({
  method: "get",
  path: "/rail/connections",
  summary: "List rail journeys grouped into connections",
  description:
    "The logbook with a change of trains read as ONE entry. Presentation only: every " +
    "statistic keeps counting legs. Legs belong together only when they share a booking, " +
    "meet at a station and the wait is known and at most four hours; a leg that returns to " +
    "a station already visited starts a new connection. A connection matches a filter when " +
    "any of its legs does and is always sent whole, so a page never cuts one. Ordered by " +
    "first departure; `meta.total` counts connections, `meta.legTotal` their legs.",
  tags: ["Rail"],
  request: { query: railConnectionQuerySchema },
  responses: {
    200: {
      description: "One page of connections",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(railConnection),
            meta: z.object({
              total: z.number().int().describe("Connections in the FILTERED set"),
              legTotal: z.number().int().describe("Legs those connections carry"),
              summary: railListSummarySchema,
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
  path: "/rail/connections/{legId}",
  summary: "Get the connection a rail journey belongs to",
  description:
    "The whole ride the given leg is part of — itself alone when it has no change of " +
    "trains — with the booking that binds it.",
  tags: ["Rail"],
  request: { params: z.object({ legId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The connection",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: railConnection.extend({
              booking: z.object({ id: z.string().uuid(), pnr: z.string().nullable() }).nullable(),
            }),
          }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
    404: { description: "No such journey, or not the caller's", content: errorContent },
  },
});

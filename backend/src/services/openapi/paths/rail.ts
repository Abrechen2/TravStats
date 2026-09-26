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
import { errorContent } from "./shared";
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
            "user = typed from the ticket; route = length of the traced Transitous line; " +
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
      trip: includedRow("trip (id, name, color)").nullable().optional(),
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
  trainCategory: z.string().nullable(),
  trainNumber: z.string().nullable(),
  status: z.enum(RAIL_STATUSES),
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
      .enum(["unchanged", "traced", "straight", "kept"])
      .describe(
        "unchanged = an edit that touched neither station nor match; kept = a re-fetch " +
          "did not deliver and the frozen line stayed"
      ),
    geometrySource: z.enum(RAIL_GEOMETRY_SOURCES),
    fallback: z
      .enum(RAIL_GEOMETRY_FALLBACK_REASONS)
      .nullable()
      .describe("Why a Transitous match has no (new) traced line; null when none was asked for"),
  })
  .openapi("RailGeometryReport");

const writeEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z.object({ geometry: geometryReport }),
  });

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
    "real instant. A station with `stationId` takes position, code and country from " +
    "the catalogue. With `lookup` of provider `transitous` the server fetches that " +
    "trip's traced line once, cuts it to the two stations and freezes it " +
    "(`geometrySource: transitous`, distance along it); a missing, unreachable or " +
    "chord-only line stores `straight` and `meta.geometry.fallback` says why. Without `distanceKm` the traced or else the " +
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

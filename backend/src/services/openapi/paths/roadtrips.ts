/**
 * Roadtrips (2.7, design 2026-09-24) and the tour/roadtrip switch.
 *
 * A roadtrip is a `TripRoute` with `kind = "roadtrip"`, so its legs, tracks,
 * routing and geometry are the `/tours/{routeId}/…` endpoints documented in
 * `./tours.ts` and `./tourTracks.ts`. This module covers only what is new:
 * the list, the detail with stations and their stays, creation, the station
 * list, and moving a row between the two pages.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { tourLeg, tourRoute } from "./tours";
import { createRoadtripSchema, kindSwitchSchema, stationsSchema } from "../../../schemas/roadtrip";
import { ROADTRIP_VEHICLES, STATION_STATES, TOUR_ACTIVITIES } from "../../../shared/tour/roadtrip";

const idParams = z.object({ id: z.string().uuid() });
const routeIdParams = z.object({ routeId: z.string().uuid() });

const roadtripNights = registry.register(
  "RoadtripNights",
  z
    .object({
      stayNights: z
        .number()
        .int()
        .describe("Nights at linked stays — the same figure the lodging statistics hold"),
      freeNights: z.number().int().describe("Nights at stations with no accommodation record"),
      nights: z.number().int(),
      nightsKnown: z
        .boolean()
        .describe("False once any overnight station's length is not actually known"),
      placesSlept: z.number().int().describe("Distinct stays plus free stations"),
    })
    .openapi("RoadtripNights")
);

const roadtripSummary = registry.register(
  "RoadtripSummary",
  z
    .object({
      id: z.string().uuid(),
      kind: z.literal("roadtrip"),
      tripId: z.string().uuid().nullable(),
      tripName: z.string().nullable(),
      name: z.string(),
      mode: z.string(),
      color: z.string().nullable(),
      vehicle: z.enum(ROADTRIP_VEHICLES).nullable(),
      vehicleName: z.string().nullable(),
      kindAssignedAutomatically: z.boolean(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      distanceKm: z.number(),
      drivenKm: z.number().describe("Legs that are not a ferry"),
      startOdometerKm: z.number().int().nullable(),
      endOdometerKm: z.number().int().nullable(),
      stationCount: z.number().int(),
      nights: z.number().int(),
      stayNights: z.number().int(),
      freeNights: z.number().int(),
      nightsKnown: z.boolean(),
      placesSlept: z.number().int(),
      trackCount: z.number().int(),
      tourCount: z.number().int().describe("Day tours that set out from one of its stations"),
    })
    .openapi("RoadtripSummary")
);

const station = registry.register(
  "RoadtripStation",
  z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      notes: z.string().nullable(),
      order: z.number().int().nullable(),
      state: z
        .enum(STATION_STATES)
        .describe("stay = night at a linked stay, free = night without one, pass = no night"),
      lodgingStayId: z.string().uuid().nullable(),
      stay: z
        .object({
          id: z.string().uuid(),
          lodgingId: z.string().uuid(),
          lodgingName: z.string(),
          lodgingType: z.string(),
          city: z.string().nullable(),
          country: z.string().nullable(),
          checkIn: z.string().datetime().nullable(),
          checkOut: z.string().datetime().nullable(),
          nights: z.number().int().nullable(),
          status: z.string(),
        })
        .nullable(),
    })
    .openapi("RoadtripStation")
);

const roadtripDetail = z.object({
  roadtrip: tourRoute,
  trip: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  nights: roadtripNights,
  stations: z.array(station),
  legs: z.array(tourLeg),
  tours: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      activity: z.enum(TOUR_ACTIVITIES).nullable(),
      anchorStopId: z.string().uuid().nullable(),
      distanceKm: z.number(),
      ascentM: z.number().nullable(),
      startedAt: z.string().datetime().nullable(),
    })
  ),
  routingAvailable: z.boolean(),
});

registry.registerPath({
  method: "get",
  path: "/roadtrips",
  summary: "List the caller's roadtrips",
  description:
    "Newest first by the span its stations cover; undated roadtrips last. Nights come " +
    "from the linked stays (never counted a second time) plus the free stations.",
  tags: ["Roadtrips"],
  responses: {
    200: {
      description: "Every roadtrip the caller owns",
      content: {
        "application/json": { schema: z.object({ roadtrips: z.array(roadtripSummary) }) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/roadtrips",
  summary: "Create a roadtrip, optionally inside a trip",
  tags: ["Roadtrips"],
  request: { body: { content: { "application/json": { schema: createRoadtripSchema } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: z.object({ roadtrip: tourRoute }) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/roadtrips/{id}",
  summary: "A roadtrip with its stations, their stays, its legs and its day tours",
  tags: ["Roadtrips"],
  request: { params: idParams },
  responses: {
    200: {
      description: "The roadtrip",
      content: { "application/json": { schema: roadtripDetail } },
    },
    404: { description: "Not found, or a tour rather than a roadtrip", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/roadtrips/{id}/stations",
  summary: "Replace the complete, ordered station list",
  description:
    "Adds, moves, removes and re-links in one write; legs are recomputed in the same " +
    "transaction and keyed by endpoint station. Each station's night is exactly one of " +
    "`stay` (with the caller's own `lodgingStayId`), `free` or `pass`. A timeline stop " +
    "dropped from the list goes back to its trip rather than being deleted.",
  tags: ["Roadtrips"],
  request: {
    params: idParams,
    body: { content: { "application/json": { schema: stationsSchema } } },
  },
  responses: {
    200: {
      description: "The roadtrip after the write",
      content: {
        "application/json": {
          schema: z.object({
            roadtrip: tourRoute,
            nights: roadtripNights,
            stations: z.array(station),
            legs: z.array(tourLeg),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Roadtrip or stay not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/tours/{routeId}/kind",
  summary: "Move a row between the tour and roadtrip pages",
  description:
    "Clears the automatic-classification flag. Stay links survive a switch to tour (a " +
    "mistaken switch reversed must not lose them); a tour's anchor does not survive a " +
    "switch to roadtrip.",
  tags: ["Tours", "Roadtrips"],
  request: {
    params: routeIdParams,
    body: { content: { "application/json": { schema: kindSwitchSchema } } },
  },
  responses: {
    200: {
      description: "The row after the switch",
      content: { "application/json": { schema: z.object({ route: tourRoute }) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/tours/{routeId}/kind/confirm",
  summary: "Keep the kind the 2.7 migration chose",
  tags: ["Tours", "Roadtrips"],
  request: { params: routeIdParams },
  responses: {
    200: {
      description: "The row, no longer flagged",
      content: { "application/json": { schema: z.object({ route: tourRoute }) } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

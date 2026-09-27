/**
 * Roadtrips (2.7, design 2026-09-24) and the tour/roadtrip switch.
 *
 * A roadtrip is a `TripRoute` with `kind = "roadtrip"`, so its legs, tracks,
 * routing and geometry are the `/tours/{routeId}/…` endpoints documented in
 * `./tours.ts` and `./tourTracks.ts`. This module covers only what is new:
 * the list, the detail with stations and their stays, creation, the station
 * list, and moving a row between the two pages.
 */

import { roadtripStationTimesSchema, stayTimesSchema } from "../../../schemas/times";
import { z } from "zod";

import { registry } from "../registry";
import { errorContent, timeRefused } from "./shared";
import { tourLeg, tourRoute } from "./tours";
import { createRoadtripSchema, kindSwitchSchema, stationsSchema } from "../../../schemas/roadtrip";
import {
  STORED_ROADTRIP_VEHICLES,
  STATION_STATES,
  TOUR_ACTIVITIES,
} from "../../../shared/tour/roadtrip";
import { TRACK_SOURCES } from "../../../schemas/tour";

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
      vehicle: z.enum(STORED_ROADTRIP_VEHICLES).nullable(),
      vehicleName: z.string().nullable(),
      kindAssignedAutomatically: z.boolean(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      distanceKm: z.number(),
      drivenKm: z.number().describe("Legs that are not a ferry"),
      startOdometerKm: z.number().int().nullable(),
      endOdometerKm: z.number().int().nullable(),
      stationCount: z.number().int(),
      points: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("Station coordinates as [lon, lat], in travel order"),
      nights: z.number().int(),
      stayNights: z.number().int(),
      freeNights: z.number().int(),
      nightsKnown: z.boolean(),
      placesSlept: z.number().int(),
      trackCount: z.number().int(),
      tourCount: z.number().int().describe("Day tours that set out from one of its stations"),
      countries: z
        .array(z.string())
        .describe("ISO alpha-2 codes of the countries its stations stand in"),
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
      times: roadtripStationTimesSchema,
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
          times: stayTimesSchema,
          nights: z.number().int().nullable(),
          status: z.string(),
        })
        .nullable(),
    })
    .openapi("RoadtripStation")
);

const roadtripDetail = z.object({
  roadtrip: tourRoute,
  countries: z.array(z.string()),
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
      ascentM: z
        .number()
        .nullable()
        .describe("Summed over the recordings; null unless every one carries it"),
      movingSeconds: z
        .number()
        .int()
        .nullable()
        .describe("Summed over the recordings; null unless every one carries it"),
      startedAt: z.string().datetime().nullable(),
      source: z.enum(TRACK_SOURCES).nullable().describe("Where the first recording came from"),
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
    422: timeRefused,
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

// ---- The phone's endpoints (companion#12, #13; 2026-09-24) ----

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

registry.registerPath({
  method: "get",
  path: "/roadtrips/active",
  summary: "The roadtrip running on a given day",
  description:
    "The roadtrip whose stations' span covers `date` (the phone's LOCAL date); failing that, " +
    "one that started before it and ended at most three days earlier. Of several, the latest " +
    "started. `roadtrip` is null when none runs — never a guess. `todayStationId` is the " +
    "station whose span covers the day, the one reached last on a travel day.",
  tags: ["Roadtrips"],
  request: { query: z.object({ date: isoDay }) },
  responses: {
    200: {
      description: "The running roadtrip, or null",
      content: {
        "application/json": {
          schema: z.object({
            roadtrip: tourRoute.nullable(),
            stations: z.array(station),
            todayStationId: z.string().uuid().nullable(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/roadtrips/{id}/stations",
  summary: "Append ONE station where the phone stands",
  description:
    "The phone never sends the whole list (that is the web's PUT): it appends. Without a " +
    "`title` the server names the place by reverse geocoding. A free night covers `date` to " +
    "the next day. Idempotent for an outbox: a station of this roadtrip on the same day within " +
    "150 m answers 200 with that station, unchanged, instead of adding a second one. Legs are " +
    "recomputed and routed like a web save. A `stay` night links the caller's stay: the " +
    "station runs to its check-out (the next day when that lies before `date`) and, without a " +
    "`title`, takes the lodging's name.",
  tags: ["Roadtrips"],
  request: {
    params: idParams,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            lat: z.number(),
            lon: z.number(),
            date: isoDay,
            night: z.enum(["pass", "free", "stay"]),
            lodgingStayId: z
              .string()
              .uuid()
              .optional()
              .describe(
                'The caller\'s own stay; required with night "stay" and refused otherwise. ' +
                  "Another account's stay is a 404."
              ),
            title: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    422: timeRefused,
    200: {
      description: "Already there (a resend)",
      content: {
        "application/json": {
          schema: z.object({ station, stations: z.array(station), legs: z.array(tourLeg) }),
        },
      },
    },
    201: {
      description: "Appended",
      content: {
        "application/json": {
          schema: z.object({ station, stations: z.array(station), legs: z.array(tourLeg) }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Roadtrip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/roadtrips/{id}/stations/{stationId}",
  summary: "Take ONE station off a roadtrip (the phone's undo)",
  description:
    "Any station of the caller's roadtrip — no column records who made a station, so " +
    '"phone-appended only" cannot be told from the data. A trip\'s timeline stop goes back ' +
    "to its trip (`released: true`); a roadtrip-owned station is deleted. The rest are " +
    "renumbered and the legs recomputed, so its two neighbours are joined by one leg.",
  tags: ["Roadtrips"],
  request: { params: z.object({ id: z.string().uuid(), stationId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The roadtrip's stations and legs after the removal",
      content: {
        "application/json": {
          schema: z.object({
            removed: z.object({
              id: z.string().uuid(),
              released: z
                .boolean()
                .describe("True when the stop stays on its trip's timeline, false when deleted"),
            }),
            stations: z.array(station),
            legs: z.array(tourLeg),
          }),
        },
      },
    },
    404: { description: "Roadtrip or station not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/day-context",
  summary: "The trip and roadtrip station a day belongs to",
  description:
    "What a workout recorded that day should be anchored to (companion#13): the trip whose " +
    "dates cover it (the latest started of several) and the roadtrip station whose span covers " +
    "it (the one reached last on a travel day). Either may be null.",
  tags: ["Roadtrips", "Tours"],
  request: { query: z.object({ date: isoDay }) },
  responses: {
    200: {
      description: "Context",
      content: {
        "application/json": {
          schema: z.object({
            trip: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
            station: z
              .object({
                id: z.string().uuid(),
                title: z.string(),
                roadtripId: z.string().uuid(),
                roadtripName: z.string(),
              })
              .nullable(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
  },
});

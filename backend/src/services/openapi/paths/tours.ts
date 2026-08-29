/**
 * Tour route section endpoints — a trip's "how did we get there" layer on
 * top of its stops. All fifteen live on the four same-prefix satellite
 * routers `routes/trips/tourRoutes.ts`, `routes/trips/tourLegs.ts`,
 * `routes/trips/tourRouting.ts`, and `routes/trips/tourTracks.ts`, all
 * mounted at the plain `/trips` base, which is why every path here starts
 * with `/trips/{id}/routes` rather than its own top-level segment.
 *
 * None of these responses use the `{success, data}` envelope the cruise
 * endpoints use — they follow the older bare-object convention `trips.ts`
 * itself uses (`{ route: ... }`, `{ leg: ... }`).
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  createRouteSchema,
  updateRouteSchema,
  assignStopsSchema,
  legOverrideSchema,
  pullDawarichTrackSchema,
  TRACK_SOURCES,
} from "../../../schemas/tour";
import { LEG_MODES, LEG_SOURCES } from "../../../services/tour/tourDistance";

const legMode = z.enum(LEG_MODES).describe("Per-leg travel mode, not per section");
const legSource = z
  .enum(LEG_SOURCES)
  .describe(
    "How the geometry was produced. The server writes 'straight' (the " +
      "default chord), 'drawn' (a hand-drawn override), 'routed' (computed " +
      "by the configured routing provider via POST .../route or POST " +
      ".../route-all, phase 3 task 6), and 'track' (a segment adopted from " +
      "a recorded TripRouteTrack via the leg-override endpoint's `track` " +
      "branch, phase 3b task 5).",
  );
const confidence = z.enum(["low", "medium", "high"]);

const tourRoute = registry.register(
  "TourRoute",
  z
    .object({
      id: z.string().uuid(),
      tripId: z.string().uuid(),
      name: z.string(),
      mode: legMode.describe("Default mode for legs created in this section"),
      orderIdx: z.number().int(),
      color: z.string().nullable(),
      notes: z.string().nullable(),
      startOdometerKm: z.number().int().nullable(),
      endOdometerKm: z.number().int().nullable(),
      stopCount: z.number().int(),
      legCount: z.number().int(),
      distanceKm: z.number().describe("Sum of every leg's distanceKm, any mode"),
      drivenKm: z
        .number()
        .describe("Same sum restricted to road legs — the odometer-comparable figure"),
    })
    .openapi("TourRoute", {
      example: {
        id: "b6b6f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2a",
        tripId: "a1a1a1a1-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
        name: "Süd-Norwegen",
        mode: "road",
        orderIdx: 0,
        color: "#2563eb",
        notes: null,
        startOdometerKm: 84210,
        endOdometerKm: 84890,
        stopCount: 2,
        legCount: 1,
        distanceKm: 305.4,
        drivenKm: 305.4,
      },
    }),
);

const tourStop = registry.register(
  "TourRouteStop",
  z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      lat: z.number(),
      lon: z.number(),
      routeOrderIdx: z.number().int().describe("0-based position within the section"),
    })
    .openapi("TourRouteStop"),
);

const tourLeg = registry.register(
  "TourRouteLeg",
  z
    .object({
      id: z.string().uuid(),
      fromStopId: z.string().uuid(),
      toStopId: z.string().uuid(),
      distanceKm: z.number(),
      source: legSource,
      mode: legMode,
      confidence,
      waypoints: z
        .array(z.tuple([z.number(), z.number()]))
        .nullable()
        .describe("[[lon, lat], …]. Null for a straight (chord) leg."),
      drivingMinutes: z.number().int().nullable(),
      tollCost: z.number().nullable(),
      currency: z.string().nullable(),
    })
    .openapi("TourRouteLeg", {
      example: {
        id: "c7c7f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2b",
        fromStopId: "d1d1d1d1-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
        toStopId: "d2d2d2d2-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
        distanceKm: 305.4,
        source: "straight",
        mode: "road",
        confidence: "low",
        waypoints: null,
        drivingMinutes: null,
        tollCost: null,
        currency: null,
      },
    }),
);

const tourRouteGeometry = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.tuple([z.number(), z.number()])),
        }),
        properties: z.object({
          legId: z.string().uuid(),
          source: legSource,
          mode: legMode,
          distanceKm: z.number(),
          confidence,
        }),
      }),
    ),
  })
  .describe(
    "GeoJSON, coordinates in [lon, lat] order. One LineString per leg, in " +
      "itinerary order. A leg with a hand-drawn or routed line emits its " +
      "stored waypoints; a straight leg emits its two endpoint stops — " +
      "exactly the chord its distanceKm was computed from, so the picture " +
      "and the number never disagree. A section with fewer than two stops " +
      "has no legs, so `features` comes back empty rather than 404.",
  )
  .openapi("TourRouteGeometry", {
    example: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [8.0, 58.15],
              [5.32, 60.39],
            ],
          },
          properties: {
            legId: "c7c7f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2b",
            source: "straight",
            mode: "road",
            distanceKm: 305.4,
            confidence: "low",
          },
        },
      ],
    },
  });

const tripIdParam = z.object({ id: z.string().uuid() });
const routeIdParams = z.object({ id: z.string().uuid(), routeId: z.string().uuid() });
const legParams = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  fromStopId: z.string().uuid(),
  toStopId: z.string().uuid(),
});

const routeCreateInput = registry.register(
  "TourRouteCreateInput",
  createRouteSchema.openapi("TourRouteCreateInput", {
    example: { name: "Süd-Norwegen", mode: "road", color: "#2563eb" },
  }),
);
const routeUpdateInput = registry.register(
  "TourRouteUpdateInput",
  updateRouteSchema.openapi("TourRouteUpdateInput", {
    example: { name: "Süd-Norwegen (Umweg)", endOdometerKm: 84920 },
  }),
);
const assignStopsInput = registry.register(
  "TourRouteStopsInput",
  assignStopsSchema.openapi("TourRouteStopsInput", {
    example: {
      stopIds: [
        "d1d1d1d1-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
        "d2d2d2d2-1a1a-1a1a-1a1a-1a1a1a1a1a1a",
      ],
    },
  }),
);
const legOverrideInput = registry.register(
  "TourRouteLegOverrideInput",
  legOverrideSchema.openapi("TourRouteLegOverrideInput", {
    description:
      "A discriminated union on `source`. `straight`/`drawn` optionally " +
      "carry hand-drawn `waypoints` (required for `drawn`, forbidden for " +
      "`straight`). `track` carries a REQUIRED `trackId` instead — no " +
      "`waypoints` — the geometry comes from the referenced " +
      "TripRouteTrack via the adoption endpoint logic, not the request body.",
    example: {
      source: "drawn",
      mode: "road",
      waypoints: [
        [8.0, 58.15],
        [7.4, 59.1],
        [5.32, 60.39],
      ],
    },
  }),
);

/* ─────────────────────────────── sections ────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/trips/{id}/routes",
  summary: "List a trip's route sections",
  description:
    "A tour is split into one or more named sections (e.g. 'Hinfahrt', " +
    "'Rundtour Süd-Norwegen', 'Rückfahrt'), each with its own default mode " +
    "and running total.",
  tags: ["Tours"],
  request: { params: tripIdParam },
  responses: {
    200: {
      description: "Sections, in orderIdx order",
      content: { "application/json": { schema: z.object({ routes: z.array(tourRoute) }) } },
    },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/routes",
  summary: "Create a route section",
  description: "New sections are appended after the current highest orderIdx.",
  tags: ["Tours"],
  request: {
    params: tripIdParam,
    body: { content: { "application/json": { schema: routeCreateInput } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.object({ route: tourRoute }) } } },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/routes/{routeId}",
  summary: "Update a route section",
  description: "Partial update. Omitting a field leaves it unchanged.",
  tags: ["Tours"],
  request: {
    params: routeIdParams,
    body: { content: { "application/json": { schema: routeUpdateInput } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: z.object({ route: tourRoute }) } } },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/routes/{routeId}",
  summary: "Get one route section with its stops and legs",
  description:
    "The same envelope `PUT .../stops` returns, widened with " +
    "`routingAvailable` (task 6): whether a routing provider is configured " +
    "for this instance, so the client can decide whether to offer " +
    "'Route this leg' / 'Route the whole section' at all. This is exactly " +
    "the page load the route editor already performs to open a section, " +
    "so the flag rides along here rather than behind a dedicated endpoint " +
    "the editor would otherwise have to call separately every time it " +
    "opens. A pure read — no transaction, nothing written, unlike the " +
    "write endpoint above (whose 409 guard exists because concurrent " +
    "claims on that path are expected).",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    200: {
      description: "Section, its stops in order, its legs, and routing availability",
      content: {
        "application/json": {
          schema: z.object({
            route: tourRoute,
            stops: z.array(tourStop),
            legs: z.array(tourLeg),
            routingAvailable: z
              .boolean()
              .describe("Whether a routing provider is configured for this instance"),
          }),
        },
      },
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/routes/{routeId}",
  summary: "Delete a route section",
  description:
    "Deletes the section and its legs. Its stops are RELEASED, not deleted — " +
    "a tour is scaffolding over the timeline; removing the scaffolding must " +
    "not remove the timeline entries themselves.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

/* ────────────────────────────────  stops  ─────────────────────────────── */

registry.registerPath({
  method: "put",
  path: "/trips/{id}/routes/{routeId}/stops",
  summary: "Replace a section's ordered stop list",
  description:
    "Sets the complete itinerary of this section, replacing whatever was " +
    "there. Every stop needs a coordinate, and a stop already assigned to a " +
    "DIFFERENT section is rejected rather than silently stolen from it. " +
    "Legs are recomputed to match the new order: a leg whose endpoint pair " +
    "survives keeps its row (geometry, source and manual costs included), " +
    "a leg whose pair vanished is deleted, and a new pair starts as a " +
    "straight chord.",
  tags: ["Tours"],
  request: {
    params: routeIdParams,
    body: { content: { "application/json": { schema: assignStopsInput } } },
  },
  responses: {
    200: {
      description: "Section, its stops in order, and its recomputed legs",
      content: {
        "application/json": {
          schema: z.object({
            route: tourRoute,
            stops: z.array(tourStop),
            legs: z.array(tourLeg),
          }),
        },
      },
    },
    400: { description: "Validation failed, or a stop belongs to another section", content: errorContent },
    404: { description: "Not found", content: errorContent },
    409: { description: "A stop changed section while this request was in flight", content: errorContent },
  },
});

/* ─────────────────────────────  leg overrides  ────────────────────────── */

registry.registerPath({
  method: "put",
  path: "/trips/{id}/routes/{routeId}/legs/{fromStopId}/{toStopId}",
  summary: "Hand-correct one leg's line, or adopt a recorded track",
  description:
    "Replaces the straight chord between two consecutive stops. The leg " +
    "must already exist between those two stops — there is no leg for a " +
    "pair the itinerary doesn't contain. Three shapes of `source`: " +
    "`straight` (back to a plain chord) or `drawn` (a hand-drawn line — " +
    "its first and last points must land within 1 km of the leg's own " +
    "stops, the anchor tolerance; anything looser is rejected rather than " +
    "silently accepted), or `track` (phase 3b, task 5 — adopts the " +
    "segment of an already-uploaded TripRouteTrack that runs between this " +
    "leg's two stops; the SAME 1 km anchor tolerance applies to both of " +
    "the track's nearest points, and a non-covering track 409s rather " +
    "than silently falling back to a straight chord). `\"routed\"` " +
    "geometry comes from the routing provider, not a request body, so " +
    "this endpoint refuses it (400) and names the routing endpoint " +
    "(`POST .../route` / `.../route-all`) instead of silently accepting " +
    "a caller-supplied line mislabelled as provider-routed.",
  tags: ["Tours"],
  request: {
    params: legParams,
    body: { content: { "application/json": { schema: legOverrideInput } } },
  },
  responses: {
    200: { description: "Leg updated", content: { "application/json": { schema: z.object({ leg: tourLeg }) } } },
    400: {
      description:
        "Validation failed — an unrecognised source (including " +
        "\"routed\"), a `drawn` leg with fewer than two waypoints, a " +
        "`straight` leg carrying waypoints, a `track` leg with no " +
        "`trackId`, or a `drawn`/`straight` line that doesn't anchor to " +
        "the leg's stops",
      content: errorContent,
    },
    404: {
      description:
        "Trip, section or leg not found, or (for source: \"track\") the " +
        "trackId doesn't belong to this route",
      content: errorContent,
    },
    409: {
      description:
        "The leg's stop lost its coordinates, or (for source: \"track\") " +
        "the track doesn't come within the anchor tolerance of both stops",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/routes/{routeId}/legs/{fromStopId}/{toStopId}",
  summary: "Drop a leg's hand-drawn line",
  description: "Removes the override so the leg falls back to a straight chord.",
  tags: ["Tours"],
  request: { params: legParams },
  responses: {
    204: { description: "Reverted to a straight chord" },
    404: { description: "Trip, section or leg not found", content: errorContent },
    409: { description: "The leg's stop lost its coordinates", content: errorContent },
  },
});

/* ─────────────────────────────  provider routing  ─────────────────────── */

registry.registerPath({
  method: "post",
  path: "/trips/{id}/routes/{routeId}/legs/{fromStopId}/{toStopId}/route",
  summary: "Route one leg through the configured provider",
  description:
    "Computes this leg's geometry via whichever routing provider the " +
    "instance has configured (admin settings, plus a per-user API key " +
    "where the provider needs one) and stores the result. A ferry or rail " +
    "leg, or a provider answer that does not anchor to the leg's stops or " +
    "looks implausible, still comes back 200 — the leg falls back to its " +
    "straight chord with `confidence: \"low\"`, an honest result rather " +
    "than an error. Only a genuinely unconfigured instance (no provider at " +
    "all) is refused, and with 409 rather than 400 — the request itself is " +
    "fine, the instance just cannot answer it.",
  tags: ["Tours"],
  request: { params: legParams },
  responses: {
    200: { description: "Leg routed (or honestly left as a straight chord)", content: { "application/json": { schema: z.object({ leg: tourLeg }) } } },
    404: { description: "Trip, section or leg not found", content: errorContent },
    409: {
      description:
        "The leg's stop lost its coordinates, or no routing provider is configured",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/routes/{routeId}/route-all",
  summary: "Route every routable leg of a section in one call",
  description:
    "Runs every leg whose mode a road router can answer (road, foot, bike) " +
    "through the configured provider; a ferry or rail leg is left " +
    "untouched. Unlike the single-leg endpoint above, an unconfigured " +
    "provider does not 409 here — every routable leg simply falls back to " +
    "its straight chord, same as an individual provider failure would, and " +
    "the response says so honestly via `routedCount` (legs run through the " +
    "routing pipeline, whatever the outcome) and `skippedCount` (legs left " +
    "alone because their mode is not routable). This always answers 200: " +
    "routing that did not produce a route is not a request error.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    200: {
      description: "Section, its updated legs, and how many were routed vs. skipped",
      content: {
        "application/json": {
          schema: z.object({
            route: tourRoute,
            legs: z.array(tourLeg),
            routedCount: z.number().int().describe("Legs run through the routing pipeline"),
            skippedCount: z.number().int().describe("Legs left alone — ferry/rail, not routable"),
          }),
        },
      },
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

/* ──────────────────────────────  geometry  ────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/trips/{id}/routes/{routeId}/geometry",
  summary: "Map geometry for one route section",
  description:
    "One LineString per leg, in itinerary order, so the map can colour each " +
    "leg by its own mode and dash the ones that are still a straight chord.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    200: { description: "Route geometry", content: { "application/json": { schema: tourRouteGeometry } } },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

/* ────────────────────────────────  tracks  ────────────────────────────── */

const trackSource = z
  .enum(TRACK_SOURCES)
  .describe(
    "How the track was captured. 'gpx' (task 4) — a user-uploaded GPX " +
      "file. 'dawarich' (task 7) — pulled from a self-hosted Dawarich " +
      "instance via POST .../tracks/dawarich.",
  );

const pullDawarichTrackInput = registry.register(
  "PullDawarichTrackInput",
  pullDawarichTrackSchema.openapi("PullDawarichTrackInput", {
    description:
      "Both sides optional — an omitted side falls back to the section's " +
      "own date span, derived from its stops' dates, so an empty body " +
      "pulls exactly the section's own window.",
    example: {},
  }),
);

const tourRouteTrackMeta = registry.register(
  "TourRouteTrackMeta",
  z
    .object({
      id: z.string().uuid(),
      routeId: z.string().uuid(),
      source: trackSource,
      name: z.string().nullable(),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime(),
      pointCount: z.number().int().describe("Point count of the RAW recording, before simplification"),
      distanceKm: z.number().describe("Distance measured on the RAW recording, before simplification"),
      createdAt: z.string().datetime(),
    })
    .openapi("TourRouteTrackMeta", {
      example: {
        id: "e5e5f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2c",
        routeId: "b6b6f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2a",
        source: "gpx",
        name: "Fjord Loop",
        startedAt: "2026-06-01T08:00:00.000Z",
        endedAt: "2026-06-01T08:10:00.000Z",
        pointCount: 3,
        distanceKm: 1.7,
        createdAt: "2026-06-02T09:00:00.000Z",
      },
    }),
);

const tourRouteTrack = registry.register(
  "TourRouteTrack",
  tourRouteTrackMeta
    .extend({
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("[[lon, lat], …], simplified on import — see pointCount for the raw count"),
    })
    .openapi("TourRouteTrack"),
);

const trackParams = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  trackId: z.string().uuid(),
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/routes/{routeId}/tracks",
  summary: "Upload a recorded GPX track for a route section",
  description:
    "multipart/form-data; one GPX file under the field name 'file'. The " +
    "pipeline is parseGpx -> ingestTrack -> store: a file that cannot be " +
    "read as GPX at all is refused with one 400 message, a file that reads " +
    "fine but has no timestamps is refused with a DIFFERENT 400 message " +
    "(it cannot be placed in time) — the two are never collapsed into one. " +
    "Distance and point count are measured on the raw recording before the " +
    "stored geometry is simplified and capped.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    201: {
      description: "Stored",
      content: { "application/json": { schema: z.object({ track: tourRouteTrack }) } },
    },
    400: {
      description:
        "No file uploaded, the file is too large, could not be read as GPX, or has no timestamps",
      content: errorContent,
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/routes/{routeId}/tracks/dawarich",
  summary: "Pull a Dawarich time window and store it as a track",
  description:
    "Same pipeline as the GPX upload above, fed by a self-hosted Dawarich " +
    "instance instead of a file: fetch the window -> ingestTrack -> store, " +
    "source 'dawarich'. An empty body pulls the section's own date span, " +
    "derived from its stops — the common case is one click; either side " +
    "of the window can be overridden explicitly. Every failure is a 409, " +
    "never a 500 or a silently-stored empty track: no connection " +
    "configured answers `{error: \"notConfigured\"}`; an upstream Dawarich " +
    "failure answers `{error: <kind>}` using the same fixed kind " +
    "vocabulary as POST /settings/dawarich/test (unreachable, auth, " +
    "notFound, protocol, invalidUrl); a window with no points answers a " +
    "plain message, no kind, because the connection itself worked fine.",
  tags: ["Tours"],
  request: {
    params: routeIdParams,
    body: { content: { "application/json": { schema: pullDawarichTrackInput } } },
  },
  responses: {
    201: {
      description: "Pulled and stored",
      content: { "application/json": { schema: z.object({ track: tourRouteTrack }) } },
    },
    400: {
      description:
        "Invalid body, or no explicit window AND no dated stops to derive one from",
      content: errorContent,
    },
    404: { description: "Trip or section not found", content: errorContent },
    409: {
      description:
        "Not configured, an upstream Dawarich failure (with a kind), or an empty window",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/routes/{routeId}/tracks",
  summary: "List a section's recorded tracks",
  description:
    "Metadata only — no geometry. A track is location history: shipping it " +
    "on a list call would mean megabytes per request and put a user's " +
    "movements into a response an intermediary might cache. Fetch one " +
    "track's geometry via the single-track endpoint below.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    200: {
      description: "Tracks, oldest first",
      content: { "application/json": { schema: z.object({ tracks: z.array(tourRouteTrackMeta) }) } },
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/routes/{routeId}/tracks/{trackId}",
  summary: "Get one recorded track, with its geometry",
  tags: ["Tours"],
  request: { params: trackParams },
  responses: {
    200: {
      description: "The track, including its simplified geometry",
      content: { "application/json": { schema: z.object({ track: tourRouteTrack }) } },
    },
    404: { description: "Trip, section, or track not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/routes/{routeId}/tracks/{trackId}",
  summary: "Delete a recorded track",
  tags: ["Tours"],
  request: { params: trackParams },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Trip, section, or track not found", content: errorContent },
  },
});

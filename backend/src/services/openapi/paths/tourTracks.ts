import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { pullDawarichTrackSchema, TRACK_SOURCES } from "../../../schemas/tour";
import { registerSectionPath, routeIdParams } from "./tours";

/**
 * The recorded tracks of a tour section.
 *
 * Split out of `tours.ts` on 2026-09-21: that file crossed the 800-line
 * limit when every section endpoint gained its trip-less twin. The split
 * is along the seam the file already had — the `tracks` banner.
 */

/* ────────────────────────────────  tracks  ────────────────────────────── */

const trackSource = z
  .enum(TRACK_SOURCES)
  .describe(
    "How the track was captured. 'gpx' (task 4) — a user-uploaded GPX " +
      "file. 'dawarich' (task 7) — pulled from a self-hosted Dawarich " +
      "instance via POST .../tracks/dawarich."
  );

const pullDawarichTrackInput = registry.register(
  "PullDawarichTrackInput",
  pullDawarichTrackSchema.openapi("PullDawarichTrackInput", {
    description:
      "Both sides optional — an omitted side falls back to the section's " +
      "own date span, derived from its stops' dates, so an empty body " +
      "pulls exactly the section's own window.",
    example: {},
  })
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
      pointCount: z
        .number()
        .int()
        .describe("Point count of the RAW recording, before simplification"),
      distanceKm: z
        .number()
        .describe("Distance measured on the RAW recording, before simplification"),
      truncated: z
        .boolean()
        .describe(
          "True when a Dawarich pull was cut short by the server's page cap " +
            "(MAX_PAGES in dawarichClient.ts): the stored track covers only " +
            "the newest part of the requested time window, per Dawarich's " +
            "measured newest-first ordering — never the whole span asked for. " +
            "distanceKm above is therefore a PARTIAL measurement, not the " +
            "complete one it would otherwise look like. Always false for " +
            'source: "gpx", which refuses an oversized file outright instead ' +
            "of ever storing a silently-shortened one."
        ),
      ascentM: z
        .number()
        .nullable()
        .describe(
          "Climb in metres, measured on the raw points with hysteresis; null without elevation"
        ),
      descentM: z.number().nullable(),
      movingSeconds: z
        .number()
        .int()
        .nullable()
        .describe("Time actually moving; null when the points carry no times"),
      externalRef: z
        .string()
        .nullable()
        .describe("The source record's own id (a HealthKit workout UUID), unique per route"),
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
        truncated: false,
        ascentM: 334,
        descentM: 0,
        movingSeconds: 540,
        externalRef: null,
        createdAt: "2026-06-02T09:00:00.000Z",
      },
    })
);

const tourRouteTrack = registry.register(
  "TourRouteTrack",
  tourRouteTrackMeta
    .extend({
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("[[lon, lat], …], simplified on import — see pointCount for the raw count"),
      cumulativeKm: z
        .array(z.number())
        .nullable()
        .describe("Raw running distance at each vertex — the x axis of the elevation profile"),
      elevations: z
        .array(z.number().nullable())
        .nullable()
        .describe("Metres at each vertex, aligned with geometry; null where the source had none"),
    })
    .openapi("TourRouteTrack")
);

const trackParams = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  trackId: z.string().uuid(),
});

registerSectionPath({
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

registerSectionPath({
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
    'configured answers `{error: "notConfigured"}`; an upstream Dawarich ' +
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
      description: "Invalid body, or no explicit window AND no dated stops to derive one from",
      content: errorContent,
    },
    404: { description: "Trip or section not found", content: errorContent },
    409: {
      description: "Not configured, an upstream Dawarich failure (with a kind), or an empty window",
      content: errorContent,
    },
  },
});

registerSectionPath({
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
      content: {
        "application/json": { schema: z.object({ tracks: z.array(tourRouteTrackMeta) }) },
      },
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

registerSectionPath({
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

registerSectionPath({
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

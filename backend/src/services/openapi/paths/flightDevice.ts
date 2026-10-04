import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { timeValueSchema } from "../../../shared/time/wire";
import {
  FLIGHT_TRACK_MAX_POINTS,
  flightTrackUploadSchema,
  observedTimesSchema,
} from "../../../schemas/flightDevice";

/**
 * What a paired phone sends about a flight (forgejo#193, #194):
 * `routes/flights/track.ts` and `routes/flights/observedTimes.ts`. Bare, like
 * every flights router. Both accept the session cookie or the Companion's
 * paired-device token (a write-scoped PAT).
 */

const flightParams = z.object({ id: z.string().uuid() });

const trackMeta = z.object({
  id: z.string().uuid(),
  flightId: z.string().uuid(),
  source: z.literal("companion"),
  uploadId: z.string().describe("The client's id for the upload; a retry sends the same one"),
  deviceId: z.string().nullable().describe("The paired device that sent it; null from a browser"),
  times: z
    .object({ startedAt: timeValueSchema, endedAt: timeValueSchema })
    .describe(
      "First and last fix — the start on the departure airport's clock, the end on the arrival's"
    ),
  pointCount: z.number().int().describe("Points of the RAW recording, before simplification"),
  distanceKm: z
    .number()
    .describe("Measured on the raw points; stretches without a fix (steps over 50 km) excluded"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const flightTrack = registry.register(
  "FlightTrack",
  trackMeta
    .extend({
      geometry: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("GeoJSON LineString coordinates [lon, lat], simplified to at most 2000"),
      segmentStarts: z
        .array(z.number().int())
        .describe(
          "Index into geometry where each recorded stretch starts; the gaps between are holes"
        ),
      elevations: z
        .array(z.tuple([z.number(), z.number()]))
        .nullable()
        .describe("Altitude profile as [km, metres] pairs; null when no point carried an altitude"),
    })
    .openapi("FlightTrack")
);

registry.registerPath({
  method: "get",
  path: "/flights/{id}/track",
  summary: "The phone's recording of a flight",
  description: "`{ track: null }` when no recording was sent — that is an answer, not an error.",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "The recording, or null",
      content: { "application/json": { schema: z.object({ track: flightTrack.nullable() }) } },
    },
    404: { description: "Flight not found", content: errorContent },
  },
});

const writeAnswer = z.object({
  track: trackMeta,
  replayed: z
    .boolean()
    .describe("True when this uploadId was already stored and nothing was written"),
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/track",
  summary: "Upload the phone's recording of a flight",
  description:
    `Up to ${FLIGHT_TRACK_MAX_POINTS} points with non-decreasing times; body at most 8 MB. ` +
    "Idempotent per uploadId: a retry answers 200 with the stored recording. A recording " +
    "under another uploadId is refused (409 TRACK_ALREADY_RECORDED) unless `replace: true`. " +
    "The span must overlap the flight's schedule widened by 12 h (422 TRACK_OUTSIDE_FLIGHT). " +
    "Kept apart from the provider route (`actualRoute`), which lookups overwrite.",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: { content: { "application/json": { schema: flightTrackUploadSchema } } },
  },
  responses: {
    200: {
      description: "Retry of a stored upload",
      content: { "application/json": { schema: writeAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: writeAnswer } } },
    400: { description: "Invalid body (VALIDATION_FAILED)", content: errorContent },
    403: { description: "Read-only token, or the shared demo account", content: errorContent },
    404: { description: "Flight not found", content: errorContent },
    409: {
      description: "Another recording is stored (TRACK_ALREADY_RECORDED)",
      content: errorContent,
    },
    413: { description: "Body too large (TRACK_BODY_TOO_LARGE)", content: errorContent },
    422: { description: "Nowhere near the flight (TRACK_OUTSIDE_FLIGHT)", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/flights/{id}/track",
  summary: "Remove the phone's recording of a flight",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "1 when a recording was removed, 0 when there was none",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    404: { description: "Flight not found", content: errorContent },
  },
});

const change = z.object({
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  type: z.enum(["added", "removed", "changed"]),
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/observed-times",
  summary: "Report the takeoff and/or landing the phone observed",
  description:
    "Evidence kind `device_gps`. Handled like a live provider's report: a past landing marks " +
    "the flight flown at once, and the times become a pending flight update " +
    "(`apiSource: device_gps`) under the user's review rule — auto-applied only when approval " +
    "is switched off AND the observation fills an empty actual time; one that would replace a " +
    "stored value always waits for review. An airport other than the flight's own is refused " +
    "(422 OBSERVED_AIRPORT_MISMATCH, `field` names the end) — a diversion is not an arrival " +
    "at the destination. Times more than 5 min ahead are refused (400 OBSERVED_TIME_IN_FUTURE), " +
    "more than 12 h off the schedule too (422 OBSERVED_TIME_OUTSIDE_FLIGHT).",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: { content: { "application/json": { schema: observedTimesSchema } } },
  },
  responses: {
    200: {
      description: "What became of the observation",
      content: {
        "application/json": {
          schema: z.object({
            outcome: z.enum(["unchanged", "pending", "applied"]),
            pendingUpdateId: z.string().uuid().nullable(),
            markedFlown: z.boolean().describe("This observation ended 'scheduled'"),
            changes: z.array(change),
          }),
        },
      },
    },
    400: { description: "Invalid body or a future time", content: errorContent },
    403: { description: "Read-only token", content: errorContent },
    404: { description: "Flight not found", content: errorContent },
    422: { description: "Not this flight's airport or schedule", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

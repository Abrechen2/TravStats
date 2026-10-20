import { z } from "zod";

import { registry } from "../registry";
import { errorContent, jitterDroppedField } from "./shared";
import { localDateValueSchema, timeValueSchema } from "../../../shared/time/wire";
import {
  TRIP_RECORDING_MAX_POINTS,
  tripRecordingQuerySchema,
  tripRecordingUploadSchema,
} from "../../../schemas/tripRecording";

/**
 * The Companion's trip recording (forgejo#316): `routes/trips/tripRecording.ts`.
 * Bare, like every trip router. Private to its owner — never part of trip
 * sharing, a `.travstats` file, a public link, a comparison or federation.
 */

const tripParams = z.object({ id: z.string().uuid() });

const uploadAnswer = z.object({
  batchId: z
    .string()
    .uuid()
    .nullable()
    .describe("The stored batch; null when no point was left to store"),
  accepted: z.number().int().describe("Points stored"),
  outsideTrip: z
    .number()
    .int()
    .describe("Points outside the trip's days (first local day 00:00 to last 23:59:59); dropped"),
  inFlight: z
    .number()
    .int()
    .describe(
      "Points inside a trip flight's recorder window (departure −30 min to arrival +30 min); " +
        "dropped — the flight recording has them"
    ),
  replayed: z.boolean().describe("True when this uploadId was already stored; nothing was written"),
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/recording",
  summary: "Upload positions the Companion recorded during a trip",
  description:
    `Up to ${TRIP_RECORDING_MAX_POINTS} points per upload, body at most 1 MB. Idempotent per ` +
    "uploadId: a retry answers 200 with what was stored. Kept until the user deletes it.",
  tags: ["Trips"],
  request: {
    params: tripParams,
    body: { content: { "application/json": { schema: tripRecordingUploadSchema } } },
  },
  responses: {
    200: {
      description: "A retry of a stored upload, or nothing left to store",
      content: { "application/json": { schema: uploadAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: uploadAnswer } } },
    400: {
      description: "RECORDING_INVALID_POINT (a coordinate off the globe) or VALIDATION_FAILED",
      content: errorContent,
    },
    403: { description: "Read-only token, or the shared demo account", content: errorContent },
    404: { description: "Trip not found — `code: TRIP_NOT_FOUND`", content: errorContent },
    409: {
      description:
        "TRIP_RECORDING_DISABLED (the account switch `tripRecording.enabled` is off; nothing " +
        "stored) or RECORDING_UPLOAD_ID_REUSED (the uploadId is stored under another trip)",
      content: errorContent,
    },
    413: { description: "Body too large (TRACK_BODY_TOO_LARGE)", content: errorContent },
    422: {
      description: "TRIP_RECORDING_NO_SPAN — the trip has no first or last day",
      content: errorContent,
    },
    429: { description: "Rate limited", content: errorContent },
  },
});

const recordingView = z.object({
  summary: z.object({
    pointCount: z.number().int().describe("Points shown (of `day` when filtered)"),
    jitterDropped: jitterDroppedField.describe(
      "Of the points shown, how many the map line leaves out as GPS jitter (a still phone's " +
        "cloud collapsed to one point, a teleport spike, a stale fix — forgejo#319). The stored " +
        "points and the GPX keep every one. Always a number here: every stored point has a time"
    ),
    firstAt: timeValueSchema.nullable().describe("First point shown, on the trip's clock"),
    lastAt: timeValueSchema.nullable().describe("Last point shown, on the trip's clock"),
    devices: z.array(z.string()).describe("The paired devices that sent points"),
    days: z
      .array(localDateValueSchema)
      .describe("Every day with points on the trip's clock, whatever `day` filters to"),
  }),
  segments: z
    .array(z.array(z.tuple([z.number(), z.number()])))
    .describe(
      "[lon, lat] lines per device, jitter removed, cut where two fixes are > 2 h or > 50 km " +
        "apart (a gap is never joined), simplified for display"
    ),
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/recording",
  summary: "The trip's recording: summary and map line",
  description:
    "`pointCount: 0` and no segments when nothing was recorded — an answer, not an error. The " +
    "trip's clock is its start zone, else its end zone, else the profile zone.",
  tags: ["Trips"],
  request: { params: tripParams, query: tripRecordingQuerySchema },
  responses: {
    200: {
      description: "The recording",
      content: { "application/json": { schema: recordingView } },
    },
    400: { description: "Invalid day (VALIDATION_FAILED)", content: errorContent },
    404: { description: "Trip not found — `code: TRIP_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/recording/gpx",
  summary: "The trip's recording as a GPX file",
  description: "Every raw point with its time, one `<trkseg>` per stretch between gaps.",
  tags: ["Trips"],
  request: { params: tripParams },
  responses: {
    200: {
      description: "GPX 1.1 document, as an attachment",
      content: { "application/gpx+xml": { schema: z.string() } },
    },
    404: { description: "Trip not found — `code: TRIP_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/recording",
  summary: "Delete the trip's recording",
  description: "Every stored batch of the trip; 204 also when there was none.",
  tags: ["Trips"],
  request: { params: tripParams },
  responses: {
    204: { description: "Deleted" },
    403: { description: "Read-only token", content: errorContent },
    404: { description: "Trip not found — `code: TRIP_NOT_FOUND`", content: errorContent },
  },
});

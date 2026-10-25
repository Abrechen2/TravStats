import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  LOCATION_MAX_POINTS,
  travTrackPointsQuerySchema,
  travTrackRangeQuerySchema,
  travTrackSummaryQuerySchema,
  travTrackZoneCreateSchema,
  travTrackZoneUpdateSchema,
} from "../../../schemas/travtrack";
import { GAP_REASONS, MAX_GAPS } from "../../travtrack/limits";

/**
 * TravTrack, the own location history (TravTrack plan, phase 2):
 * `routes/travtrack.ts` and `routes/travtrack/*`. Bare.
 *
 * Every route names a gate tier (`routes/travtrack/gate.ts`); a refusal by the
 * gate is 403 `TRAVTRACK_DISABLED`.
 */

const capabilities = z.object({
  version: z.literal(1),
  offered: z.boolean().describe("The beta switch offers TravTrack on this server"),
  enabled: z.boolean().describe("The instance captures and shows TravTrack (beta + config)"),
  active: z.boolean().describe("This account's location provider is TravTrack and it works"),
  hasData: z
    .boolean()
    .describe("This account holds TravTrack data: summary, export and delete stay reachable"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/capabilities",
  summary: "What TravTrack does on this server for this account",
  description:
    "Answers whatever the switches say, read-only tokens included: it is how a client learns " +
    "that TravTrack is off instead of meeting a refusal on every call.",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "The switches as they stand",
      content: { "application/json": { schema: capabilities } },
    },
    401: { description: "No session", content: errorContent },
  },
});

const config = z.object({
  enabled: z.boolean().describe("TravTrack's instance switch (effective with the beta switch)"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/config",
  summary: "TravTrack's instance switch",
  description:
    "Admin only. Reachable while the beta switch is on, whether or not TravTrack itself is on.",
  tags: ["TravTrack"],
  responses: {
    200: { description: "The switch", content: { "application/json": { schema: config } } },
    403: {
      description: "Not an admin, or TRAVTRACK_DISABLED (beta switch off)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/travtrack/config",
  summary: "Switch TravTrack on or off for this server",
  description:
    "Admin only, write scope. Switching off stops capture and the views; nothing is deleted, " +
    "and accounts holding data keep their summary, export and delete.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: config.strict() } } } },
  responses: {
    200: { description: "The switch now", content: { "application/json": { schema: config } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "Not an admin, a token without admin scope, or TRAVTRACK_DISABLED",
      content: errorContent,
    },
  },
});

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const entryRef = z.object({ kind: z.enum(["flight", "trip"]), id: z.string().max(64) });

const pointIn = z.object({
  id: z.string().describe("The phone's own id for this fix — stable across retries"),
  t: z.string().describe("ISO instant with an offset"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional().describe("Horizontal accuracy, metres"),
  altitude: z.number().nullable().optional().describe("Metres"),
  speed: z.number().nullable().optional().describe("Metres per second"),
  course: z.number().nullable().optional().describe("Degrees from north"),
  motion: z
    .enum(["stationary", "walking", "running", "cycling", "automotive", "unknown"])
    .nullable()
    .optional(),
  purpose: z
    .enum(["everyday", "flight", "trip"])
    .optional()
    .describe("What the phone recorded the fix for; default everyday. Informational"),
  entries: z
    .array(entryRef)
    .max(4)
    .optional()
    .describe("The flights and trips the fix belongs to; one fix may belong to both"),
});

const gapIn = z.object({
  from: z.string().describe("ISO instant with an offset"),
  to: z.string().describe("ISO instant with an offset, after `from`"),
  reason: z.enum(GAP_REASONS),
});

const uploadBody = z.object({
  uploadId: z.string().min(1).max(200).describe("Same id + same content on a retry"),
  points: z.array(pointIn).max(LOCATION_MAX_POINTS),
  gaps: z
    .array(gapIn)
    .max(MAX_GAPS)
    .optional()
    .describe("What the phone could not record. At least one point or one gap per upload"),
});

const outcome = z.object({
  index: z.number().int().describe("Position of the point in the request"),
  id: z.string().nullable().describe("The point's `id` as sent; null when it had none"),
  outcome: z.enum(["stored", "duplicate", "dropped"]),
  reason: z
    .enum(["invalid", "null_island", "deleted_range", "privacy_zone"])
    .optional()
    .describe("With `dropped`: why. Every outcome is final — the client removes the point"),
});

const uploadAnswer = z.object({
  uploadId: z.string(),
  stored: z.number().int(),
  duplicate: z.number().int().describe("Already held: same fix id, or same second and position"),
  dropped: z.number().int(),
  linked: z.number().int().describe("Links to flights and trips this upload added"),
  unlinked: z.number().int().describe("Entries named that this account does not own"),
  gapsStored: z.number().int().describe("Gap pieces stored after clipping to deleted spans"),
  outcomes: z.array(outcome).describe("One per point of the request, in request order"),
  replayed: z.boolean().describe("True when this uploadId was answered before; nothing written"),
});

registry.registerPath({
  method: "post",
  path: "/travtrack/points",
  summary: "Upload positions a paired device recorded",
  description:
    `Up to ${LOCATION_MAX_POINTS} points and ${MAX_GAPS} gaps, body at most 2 MB, stored in ` +
    "one transaction. Only a paired device's write token is accepted. Idempotent per " +
    "uploadId. Does not consult the location provider: points queued before a switch are " +
    "accepted while the instance takes points. Only a non-2xx answer means: keep and resend.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: uploadBody } } } },
  responses: {
    200: {
      description: "A retry: the stored answer",
      content: { "application/json": { schema: uploadAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: uploadAnswer } } },
    400: { description: "VALIDATION_FAILED (the envelope, or a gap)", content: errorContent },
    403: {
      description:
        "TRAVTRACK_DISABLED, TRAVTRACK_DEVICE_REQUIRED, a read-only token, or the demo account",
      content: errorContent,
    },
    409: {
      description: "RECORDING_UPLOAD_ID_REUSED (the uploadId was used with other content)",
      content: errorContent,
    },
    413: { description: "Body too large (TRACK_BODY_TOO_LARGE)", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

const pointOut = z.object({
  id: z.string().uuid(),
  t: z.string().describe("ISO instant, UTC"),
  lat: z.number(),
  lon: z.number(),
  accuracy: z.number().nullable(),
  altitude: z.number().nullable(),
  speed: z.number().nullable(),
  course: z.number().nullable(),
  motion: z.string().nullable(),
  deviceId: z.string().nullable(),
  purpose: z.enum(["everyday", "flight", "trip"]),
  entries: z.array(entryRef).describe("The existing flights and trips the point belongs to"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/points",
  summary: "The points of a span, a page at a time",
  description:
    "Oldest first, ordered by time and sequence. `nextCursor` is set while more points remain " +
    "in the span; pass it back to continue.",
  tags: ["TravTrack"],
  request: { query: travTrackPointsQuerySchema },
  responses: {
    200: {
      description: "One page",
      content: {
        "application/json": {
          schema: z.object({ points: z.array(pointOut), nextCursor: z.string().nullable() }),
        },
      },
    },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: disabled,
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/summary",
  summary: "How much TravTrack history is stored",
  description:
    "Reachable with TravTrack off while the account holds data. With a span (named like a " +
    "delete) it is that span's summary — the count a delete dialog names before deleting.",
  tags: ["TravTrack"],
  request: { query: travTrackSummaryQuerySchema },
  responses: {
    200: {
      description: "The summary; zero points is an answer",
      content: {
        "application/json": {
          schema: z.object({
            pointCount: z.number().int(),
            firstAt: z.string().nullable(),
            lastAt: z.string().nullable(),
            lastReceivedAt: z.string().nullable(),
            devices: z.array(
              z.object({ deviceId: z.string().nullable(), pointCount: z.number().int() })
            ),
            deletedRanges: z.number().int().describe("Spans deleted, kept so they stay deleted"),
            zones: z.number().int().describe("Privacy zones of the account"),
          }),
        },
      },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/points",
  summary: "Delete the points of a span",
  description:
    "Hard delete of every point in `[from, to)`, or of the days `fromDay`…`toDay` (both " +
    "inclusive) on the account's profile clock, with their links; reported gaps are clipped. " +
    "The span is remembered, so a late upload cannot bring the points back. Flights and trips " +
    "stay. Reachable with TravTrack off while the account holds data.",
  tags: ["TravTrack"],
  request: { query: travTrackRangeQuerySchema },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
  },
});

const zoneOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  radiusM: z.number().int().describe("Metres"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const zoneAnswer = z.object({
  zone: zoneOut,
  deleted: z.number().int().describe("Stored positions inside the zone that were deleted"),
});

const zoneConflict =
  "LOCATION_ZONE_HOLDS_POINTS: stored positions lie inside the circle; `pointsInside` names " +
  "how many. Ask the user, then send again with `deleteStoredPoints: true`";

registry.registerPath({
  method: "get",
  path: "/travtrack/zones",
  summary: "The privacy zones — where the user is never tracked",
  description:
    "The phone syncs these and drops a fix inside one before it is ever sent. Reachable with " +
    "TravTrack off while the account holds data.",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "Oldest first",
      content: { "application/json": { schema: z.object({ zones: z.array(zoneOut) }) } },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/zones",
  summary: "Create a privacy zone",
  description: "Deletes the stored positions inside it, once confirmed. At most 20 per account.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: travTrackZoneCreateSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: zoneAnswer } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    409: { description: `${zoneConflict}; or LOCATION_ZONE_LIMIT`, content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/travtrack/zones/{id}",
  summary: "Rename, move or resize a privacy zone",
  description: "Whatever the new circle covers is deleted, once confirmed.",
  tags: ["TravTrack"],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: travTrackZoneUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: zoneAnswer } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: { description: "LOCATION_ZONE_NOT_FOUND", content: errorContent },
    409: { description: zoneConflict, content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/zones/{id}",
  summary: "Remove a privacy zone",
  description:
    "Recording resumes there; what the zone deleted stays deleted. Reachable with TravTrack " +
    "off while the account holds data.",
  tags: ["TravTrack"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Removed" },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: { description: "LOCATION_ZONE_NOT_FOUND", content: errorContent },
  },
});

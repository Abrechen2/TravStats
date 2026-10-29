import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  diagnosticsDayQuerySchema,
  diagnosticsExportQuerySchema,
} from "../../../schemas/travtrackDiagnostics";

/**
 * The TravTrack diagnostics log (spec 2026-10-29-travtrack-diagnostics):
 * upload from a paired phone, a device's day with its gaps explained, the raw
 * export, and delete.
 */

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const value = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.number().int())])
  .describe(
    "An identifier, a number with at most two decimals, a boolean, null, or integer counts"
  );

const event = z.object({
  t: z.string().describe("ISO instant with zone; at most 14 days old"),
  kind: z
    .string()
    .describe(
      "`fixes`, `upload`, `lifecycle`, `recorder`, `permission`, `power`, `note`, or a newer kind"
    ),
  data: z.record(z.string(), value).optional(),
});

const uploadBody = z.object({
  uploadId: z.string().describe("Idempotency key per device"),
  device: z
    .object({
      model: z.string().optional(),
      os: z.string().optional(),
      appVersion: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
  events: z.array(event).min(1).max(2000),
});

const uploadAnswer = z.object({
  uploadId: z.string(),
  stored: z.number().int(),
  rejected: z.array(
    z.object({
      index: z.number().int(),
      reason: z.enum(["time", "kind", "data", "coordinates"]),
    })
  ),
  replayed: z.boolean(),
});

registry.registerPath({
  method: "post",
  path: "/travtrack/diagnostics",
  summary: "Send the phone's TravTrack diagnostics log",
  description:
    "Paired devices only. Each event is judged on its own; a rejected one is final. The log " +
    "carries no position: values are typed, numbers have at most two decimals, and position " +
    "keys are refused. `fixes` events are per-minute deltas the server sums.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: uploadBody } } } },
  responses: {
    200: {
      description: "A retry: the stored answer",
      content: { "application/json": { schema: uploadAnswer } },
    },
    201: { description: "Stored", content: { "application/json": { schema: uploadAnswer } } },
    400: { description: "VALIDATION_FAILED (the envelope)", content: errorContent },
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

const device = z.object({
  deviceId: z.string(),
  label: z.string().nullable().describe("The pairing's name"),
  model: z.string().nullable(),
  os: z.string().nullable(),
  appVersion: z.string().nullable(),
  events: z.number().int(),
  points: z.number().int(),
});

const storedEvent = z.object({
  id: z.string(),
  t: z.string(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const state = z.object({
  permission: z.string().optional(),
  recorder: z.string().optional(),
  lifecycle: z.string().optional(),
});

const gap = z.object({
  from: z.string(),
  to: z.string(),
  minutes: z.number().int(),
  cause: z.enum([
    "reportedGap",
    "permission",
    "recorderPaused",
    "lostAfterUpload",
    "uploadFailed",
    "notUploaded",
    "droppedOnPhone",
    "appNotRunning",
    "noLog",
    "unexplained",
  ]),
  evidence: z.object({
    fixesReceived: z.number().int(),
    fixesKept: z.number().int(),
    dropped: z.record(z.string(), z.number()),
    uploads: z.array(
      z.object({
        uploadId: z.string(),
        status: z.number().int().nullable(),
        received: z.boolean().describe("The server holds a points receipt for it"),
      })
    ),
    permission: z.string().nullable(),
    recorder: z.string().nullable(),
    lifecycle: z.string().nullable(),
    reportedReason: z.string().nullable(),
    autoPause: z
      .boolean()
      .nullable()
      .describe("The recorder in force had iOS's automatic pause on; null when unknown"),
  }),
});

const day = z.object({
  date: z.string(),
  zone: z.string(),
  from: z.string().describe("The day's start, ISO"),
  until: z.string().describe("The day's end, or now while the day runs"),
  deviceId: z.string().nullable(),
  devices: z.array(device),
  hasLog: z.boolean(),
  pointsPerMinute: z.array(z.object({ t: z.string(), n: z.number().int() })),
  fixesPerMinute: z.array(
    z.object({
      t: z.string(),
      received: z.number(),
      kept: z.number(),
      dropped: z.record(z.string(), z.number()),
    })
  ),
  events: z.array(storedEvent).describe("Non-`fixes` events, oldest first, at most 2000"),
  eventsTruncated: z.boolean(),
  carried: state.describe("The state carried in from before the day"),
  gaps: z.array(gap).describe("Computed over the complete day"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/diagnostics/day",
  summary: "One device's diagnostics day, lined up with its points",
  description:
    "On the profile clock. Only the device's own points count. Each point-free stretch of at " +
    "least 10 minutes is cut at reported gaps and given the first cause its log supports.",
  tags: ["TravTrack"],
  request: { query: diagnosticsDayQuerySchema },
  responses: {
    200: { description: "The day", content: { "application/json": { schema: day } } },
    400: { description: "VALIDATION_FAILED: not a day", content: errorContent },
    403: disabled,
  },
});

const exportBody = z.object({
  exportedAt: z.string(),
  from: z.string(),
  to: z.string(),
  devices: z.array(device),
  events: z.array(
    z.object({
      deviceId: z.string(),
      t: z.string(),
      kind: z.string(),
      data: z.record(z.string(), z.unknown()),
    })
  ),
  pointsPerMinute: z.array(z.object({ deviceId: z.string(), t: z.string(), n: z.number().int() })),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/diagnostics/export",
  summary: "The raw diagnostics log as a file",
  description: "Every event of the span (at most 14 days), as an attachment.",
  tags: ["TravTrack"],
  request: { query: diagnosticsExportQuerySchema },
  responses: {
    200: { description: "The log", content: { "application/json": { schema: exportBody } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: disabled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/diagnostics",
  summary: "Delete the account's diagnostics log",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    403: disabled,
  },
});

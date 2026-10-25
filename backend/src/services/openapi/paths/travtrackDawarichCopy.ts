import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * Copying the account's own Dawarich history into TravTrack (TravTrack plan
 * L6): `routes/travtrack/imports.ts`. Bare. Started by the user only; Dawarich
 * is only read (GET /api/v1/points) through the account's own connection, and
 * the location provider is not touched. Deleting the copy is
 * `DELETE /travtrack/imports/{id}` with its importId.
 */

const dropped = z.object({
  privacy_zone: z.number().int(),
  deleted_range: z.number().int(),
  invalid: z.number().int().describe("Rows without a usable id, position or time"),
  null_island: z.number().int(),
});

const month = z.object({
  month: z.string().describe("YYYY-MM (UTC)"),
  read: z.number().int().describe("Rows Dawarich sent for the month"),
  stored: z.number().int(),
  duplicate: z.number().int().describe("Already held — from this or another source"),
  dropped,
  truncatedHours: z
    .array(z.string())
    .describe("Hours (YYYY-MM-DDTHH:00Z) Dawarich still truncated: only their newest slice"),
  unreachableDays: z.array(z.string()).describe("Days (YYYY-MM-DD) Dawarich gave no points for"),
  daysWithPoints: z.number().int(),
});

const totals = month.omit({ month: true, truncatedHours: true, unreachableDays: true }).extend({
  truncatedHours: z.number().int(),
  unreachableDays: z.number().int(),
});

const copyView = z.object({
  connection: z
    .enum(["own", "shared", "none"])
    .describe("`shared`: only the server's Dawarich connection, which a copy never uses"),
  copy: z
    .object({
      importId: z.string(),
      status: z.enum([
        "running",
        "paused",
        "interrupted",
        "complete",
        "incomplete",
        "failed",
        "cancelled",
      ]),
      fromDay: z.string().describe("UTC day, YYYY-MM-DD"),
      untilDay: z.string(),
      nextDay: z.string().describe("The first day not yet copied: the checkpoint"),
      daysDone: z.number().int(),
      daysTotal: z.number().int(),
      lastErrorKind: z
        .enum([
          "unreachable",
          "auth",
          "notFound",
          "protocol",
          "invalidUrl",
          "disabled",
          "notConfigured",
          "internal",
        ])
        .nullable()
        .describe("Why the copy paused or failed"),
      createdAt: z.string().datetime(),
      finishedAt: z.string().datetime().nullable(),
      totals,
      months: z.array(month),
    })
    .nullable(),
});

const started = {
  description: "Started: a job (`GET /jobs/{id}`, kind travtrack.dawarichImport)",
  content: {
    "application/json": { schema: z.object({ jobId: z.string(), importId: z.string() }) },
  },
};

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const notConfigured = {
  description:
    "DAWARICH_NOT_CONFIGURED: no own Dawarich connection (the server's is never used); " +
    "TRAVTRACK_IMPORT_RUNNING: an import of this account runs already",
  content: errorContent,
};

const rateLimited = {
  description: "RATE_LIMITED: at most 30 imports per account in 15 minutes",
  content: errorContent,
};

registry.registerPath({
  method: "post",
  path: "/travtrack/imports/dawarich",
  summary: "Copy the account's Dawarich history into TravTrack",
  description:
    "Both days or neither (UTC, inclusive); neither copies the whole history (twenty years " +
    "back, up to yesterday). Day by day through the same ingest as every source: points in a " +
    "privacy zone or a deleted span are dropped, points already held are duplicates. Starts no " +
    "stay, journey or country question. The location provider is not changed.",
  tags: ["TravTrack"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            fromDay: z.string().optional().describe("YYYY-MM-DD"),
            untilDay: z.string().optional().describe("YYYY-MM-DD"),
          }),
        },
      },
    },
  },
  responses: {
    202: started,
    400: {
      description: "VALIDATION_FAILED: a malformed or impossible range",
      content: errorContent,
    },
    403: disabled,
    409: notConfigured,
    429: rateLimited,
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/imports/dawarich",
  summary: "The Dawarich copy and how complete it is",
  description:
    "`complete` only when every day was read whole; otherwise `incomplete` with the truncated " +
    "hours and the days Dawarich gave no points for, per month. A copy no process works on any " +
    "more reads as `interrupted`.",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "The copy, or null",
      content: { "application/json": { schema: copyView } },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/imports/dawarich/resume",
  summary: "Resume a paused, interrupted or failed Dawarich copy from its checkpoint",
  tags: ["TravTrack"],
  responses: {
    202: started,
    403: disabled,
    404: { description: "TRAVTRACK_IMPORT_NOT_FOUND: no copy", content: errorContent },
    409: {
      description:
        "TRAVTRACK_IMPORT_NOT_RESUMABLE (complete or cancelled), TRAVTRACK_IMPORT_RUNNING, " +
        "DAWARICH_NOT_CONFIGURED",
      content: errorContent,
    },
    429: rateLimited,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/imports/dawarich/stop",
  summary: "Pause the running Dawarich copy",
  description: "The copy stops before its next request to Dawarich and can be resumed.",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "The copy, now paused",
      content: { "application/json": { schema: copyView } },
    },
    403: disabled,
    409: { description: "TRAVTRACK_IMPORT_NOT_RUNNING", content: errorContent },
  },
});

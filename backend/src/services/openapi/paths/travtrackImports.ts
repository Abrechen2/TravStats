import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * File imports into TravTrack (TravTrack plan E8): `routes/travtrack/imports.ts`.
 * Bare. A GPX file goes through the same ingest as the Companion's points:
 * fixes inside a privacy zone or a deleted span are dropped and counted.
 */

const dropped = z.object({
  privacy_zone: z.number().int(),
  deleted_range: z.number().int(),
  invalid: z.number().int(),
  null_island: z.number().int(),
});

const report = z
  .object({
    read: z.number().int().describe("Fixes with a position the file held"),
    stored: z.number().int(),
    duplicate: z.number().int().describe("Already held — from this or another source"),
    dropped,
    withoutTime: z.number().int().describe("Fixes without a time: not stored"),
    error: z
      .string()
      .optional()
      .describe(
        "Why the import failed: TRAVTRACK_IMPORT_NO_TIMES, TRAVTRACK_IMPORT_UNREADABLE, " +
          "TRAVTRACK_IMPORT_TOO_MANY_POINTS or JOB_FAILED"
      ),
  })
  .nullable();

const travTrackImport = z.object({
  id: z.string(),
  kind: z.enum(["gpx", "dawarich"]),
  fileName: z.string().describe("The name the file was given; a label only"),
  status: z.enum(["running", "succeeded", "failed", "interrupted", "cancelled"]),
  report,
  pointCount: z.number().int().describe("Points of this import stored now"),
  // An instant in UTC, as the summary's firstAt/lastAt: the file's first and
  // last fix, shown on the profile clock by the client.
  fromAt: z.string().nullable().describe("The file's first fix with a time, UTC ISO instant"),
  toAt: z.string().nullable().describe("The file's last fix with a time, UTC ISO instant"),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

registry.registerPath({
  method: "post",
  path: "/travtrack/imports",
  summary: "Import a GPX file into TravTrack",
  description:
    "multipart/form-data with one `file` (GPX, at most 25 MB). Answers at once with a job " +
    "(`GET /jobs/{id}`); the job fails with TRAVTRACK_IMPORT_NO_TIMES (no fix with a time) or " +
    "TRAVTRACK_IMPORT_UNREADABLE (not GPX, a file with a document type declaration, or one " +
    "too large to read in the reader's memory) or TRAVTRACK_IMPORT_TOO_MANY_POINTS (over " +
    "200,000 fixes). " +
    "An import never starts a stay, country or journey scan.",
  tags: ["TravTrack"],
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({ format: "binary" }).describe("The GPX file"),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    202: {
      description: "Started",
      content: {
        "application/json": {
          schema: z.object({ jobId: z.string(), importId: z.string() }),
        },
      },
    },
    400: {
      description: "VALIDATION_FAILED: no file, or a malformed upload",
      content: errorContent,
    },
    403: disabled,
    409: {
      description: "TRAVTRACK_IMPORT_RUNNING: an import of this account is running already",
      content: errorContent,
    },
    413: { description: "TRACK_FILE_TOO_LARGE: over 25 MB", content: errorContent },
    429: {
      description: "RATE_LIMITED: at most 30 imports per account in 15 minutes, whatever the token",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/imports",
  summary: "The account's TravTrack imports, newest first",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "Each import with its report and the count of its points stored now",
      content: {
        "application/json": { schema: z.object({ imports: z.array(travTrackImport) }) },
      },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/imports/{id}",
  summary: "Delete an import and the points it brought",
  description:
    "The import's row stays as `cancelled` (a running import stops before its next batch); " +
    "its points go, nothing else does, and no span is remembered as deleted.",
  tags: ["TravTrack"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "How many points went",
      content: { "application/json": { schema: z.object({ deleted: z.number().int() }) } },
    },
    403: disabled,
    404: { description: "TRAVTRACK_IMPORT_NOT_FOUND", content: errorContent },
  },
});

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
    format: z
      .string()
      .optional()
      .describe(
        "What the file was read as: gpx, google-records, google-semantic, google-timeline, " +
          "geojson, kml or tcx (joined with + when a file held several). Absent on imports made " +
          "before forgejo#394."
      ),
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
  summary: "Import a track file into TravTrack",
  description:
    "multipart/form-data with one `file`. The format is read from the content, not the name: " +
    "GPX, KML and TCX (XML, at most 25 MB); Google Takeout `Records.json`, Semantic Location " +
    "History month files, the on-device Timeline export and GeoJSON (JSON, at most 200 MB, " +
    "scanned in a child process and never held as a tree). The file is read on this server " +
    "only. FIT is recognised and refused. " +
    "Answers at once with a job (`GET /jobs/{id}`, `progress.done` is a percentage: the first " +
    "half reads the file, the second stores its points). The job fails with " +
    "TRAVTRACK_IMPORT_NO_TIMES (no fix with a time), TRAVTRACK_IMPORT_UNREADABLE (not a track " +
    "file, an unfinished one, a document type declaration, or one too large to read in the " +
    "reader's memory), TRAVTRACK_IMPORT_UNSUPPORTED_FORMAT (FIT), TRAVTRACK_IMPORT_BUSY (the reader has a full line) or " +
    "TRAVTRACK_IMPORT_TOO_MANY_POINTS (over 200,000 fixes in a GPX file, 2,000,000 in the " +
    "others). A time without an offset is not guessed (that fix is not stored), and an " +
    "accuracy, speed or heading the file lacks stays unknown. Fixes in a privacy zone or a " +
    "deleted span are dropped and counted; positions already held are duplicates. " +
    "An import never starts a stay, country or journey scan.",
  tags: ["TravTrack"],
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({ format: "binary" }).describe("The track file"),
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
      description:
        "TRAVTRACK_IMPORT_RUNNING: an import of this account is running already. Answered " +
        "before the body is read, and the connection is closed.",
      content: errorContent,
    },
    503: {
      description:
        "TRAVTRACK_IMPORT_BUSY: the server's file reader has a full line; try again later",
      content: errorContent,
    },
    413: {
      description: "TRACK_FILE_TOO_LARGE: over 25 MB (XML formats) or 200 MB (JSON formats)",
      content: errorContent,
    },
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
    "its points go, nothing else does, and no span is remembered as deleted. Open suggestions " +
    "drawn from its points go with them; accepted ones stay, without the deleted positions.",
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

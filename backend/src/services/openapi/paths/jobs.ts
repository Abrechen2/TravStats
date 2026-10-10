/**
 * Background jobs (2026-09-26).
 *
 * A request whose work can outlive a browser's patience — a backup, a restore,
 * a spreadsheet import, a photo-library scan, a trip's weather fill — answers
 * 202 with a job, and the client polls this endpoint for the outcome instead
 * of holding the request open and reporting a timeout as a failure.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

export const jobSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum([
    "backup.create",
    "backup.restore",
    "xlsx.import",
    "photoJourneys.scan",
    "journal.weather",
    "timeModel.backfill",
    "timeZones.reResolveDryRun",
    "timeZones.reResolveApply",
    "placeImport.resolve",
  ]),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  result: z.unknown().openapi({
    description:
      "The work's own answer once it succeeded — the body the synchronous call would have " +
      "sent in its `data` (or itself, for a bare-family endpoint). Null while running.",
  }),
  error: z
    .object({
      code: z.string().openapi({
        description:
          "Stable cause, e.g. `RESTORE_ENCRYPTION_KEY_MISMATCH`, `backup_failed`, or " +
          "`JOB_FAILED` for an unexpected failure. A backup/restore job names its cause: " +
          "`BACKUP_TOOL_MISSING`, `BACKUP_DISK_FULL`, `BACKUP_PERMISSION_DENIED`, " +
          "`BACKUP_DB_UNREACHABLE`, `BACKUP_TOOL_VERSION_MISMATCH`, else `BACKUP_FAILED` / " +
          "`RESTORE_FAILED`. Never prose.",
      }),
      status: z.number().int().openapi({
        description: "The HTTP status the same failure would have answered synchronously.",
      }),
    })
    .nullable(),
  progress: z
    .object({ done: z.number().int(), total: z.number().int() })
    .nullable()
    .openapi({
      description:
        "How far a job that reports progress has got (the zone re-resolution does); " +
        "null for one that does not.",
    }),
});

/** The 202 body of an endpoint that started a job. */
export const jobStartedSchema = z.object({
  success: z.boolean(),
  data: z.object({ jobId: z.string().uuid() }),
});

registry.registerPath({
  method: "get",
  path: "/jobs/{id}",
  summary: "The state of a background job",
  description:
    "Only the caller's own jobs; any other id answers 404. Jobs live in memory: a finished " +
    "job is kept for an hour, and a restart forgets them (the work stopped with the process).",
  tags: ["Jobs"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The job",
      content: {
        "application/json": { schema: z.object({ success: z.boolean(), data: jobSchema }) },
      },
    },
    404: { description: "No such job for this caller", content: errorContent },
  },
});

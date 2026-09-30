/**
 * The time-model migration, admin side (ADR 0002 phase 3b).
 *
 * The backfill runs once at boot and answers nothing itself; these endpoints
 * are how the owner reads what it did before promoting an RC, and how a zone
 * resolved wrongly at write time is corrected later (D2: dry run first, apply
 * only what the dry run showed). Admin-only, bare response family.
 */

import { z } from "zod";

import {
  reResolveApplyBodySchema,
  reResolveApplySchema,
  reResolveDryRunSchema,
  timeMigrationReportSchema,
} from "../../../schemas/timeMigration";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Admin", "Time model"];

const report = registry.register("TimeMigrationReport", timeMigrationReportSchema);
registry.register("TimeZoneReResolveDryRun", reResolveDryRunSchema);
registry.register("TimeZoneReResolveApply", reResolveApplySchema);

registry.registerPath({
  method: "get",
  path: "/admin/time-migration/report",
  summary: "What the time-model backfill converted, left open, and found already filled",
  description:
    "Counts per table, rule and reason from `time_migration_ledger`, every open row (capped at " +
    "1000, `openRowsTruncated` says when), the inbox questions raised, and the domains that " +
    "needed nothing. Read on the RC server before promotion: every unresolved row is listed, " +
    "none was guessed.",
  tags,
  responses: {
    200: { description: "The report", content: { "application/json": { schema: report } } },
  },
});

const jobStarted = z.object({
  jobId: z
    .string()
    .uuid()
    .openapi({
      description:
        "Poll `GET /jobs/{jobId}`. A dry-run job's `result` is a `TimeZoneReResolveDryRun`, " +
        "an apply job's a `TimeZoneReResolveApply`.",
    }),
});

registry.registerPath({
  method: "post",
  path: "/admin/time-zones/re-resolve",
  summary: "Dry run: which stored zones the resolver would answer differently today",
  description:
    "Runs the zone resolver (catalogue, then coordinates) over every stored zone and lists the " +
    "rows whose zone would change, with the local-time shift at the stored instant. Changes " +
    "nothing. Answers 202 with a job; its result carries the `dryRunId` that `apply` needs.",
  tags,
  request: { query: z.object({ dryRun: z.literal("true") }) },
  responses: {
    202: { description: "Job started", content: { "application/json": { schema: jobStarted } } },
    400: { description: "`dryRun=true` missing", content: errorContent },
    409: {
      description: "A re-resolution or the backfill is running (`RE_RESOLVE_RUNNING`)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/time-zones/re-resolve/apply",
  summary: "Apply the zone changes one dry run showed — and nothing else",
  description:
    "Writes exactly the changes the named dry run listed, only the zone columns, and only " +
    "where the stored zone is still the one the dry run saw; a row changed since is skipped " +
    "and counted. The instant is kept. 404 `DRY_RUN_NOT_FOUND` for an unknown or expired id.",
  tags,
  request: { body: { content: { "application/json": { schema: reResolveApplyBodySchema } } } },
  responses: {
    202: { description: "Job started", content: { "application/json": { schema: jobStarted } } },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Unknown or expired dry run", content: errorContent },
    409: { description: "A re-resolution is running", content: errorContent },
  },
});

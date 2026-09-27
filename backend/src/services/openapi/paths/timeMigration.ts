/**
 * The time-model migration, admin side (ADR 0002 phase 3b).
 *
 * The backfill runs once at boot and answers nothing itself; these endpoints
 * are how the owner reads what it did before promoting an RC, and how a zone
 * resolved wrongly at write time is corrected later (D2: dry run first, apply
 * only what the dry run showed). Admin-only, bare response family.
 */

import {
  reResolveApplySchema,
  reResolveDryRunSchema,
  timeMigrationReportSchema,
} from "../../../schemas/timeMigration";
import { registry } from "../registry";

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

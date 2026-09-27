import { z } from "zod";

import {
  TIME_FLAG_KINDS,
  TIME_MIGRATION_REASONS,
  TIME_MIGRATION_TABLES,
  type ReResolveApply,
  type ReResolveDryRun,
  type TimeMigrationReport,
} from "../../types/timeMigration";
import { api } from "./client";
import { type JobView, waitForJob } from "./jobs";

/**
 * The admin half of the time-model migration (ADR 0002, plan Phase 3b): the
 * migration report, and the zone re-resolution (D2) — a dry run the admin
 * reads, then an apply that names that dry run. Both run as jobs on the
 * server; the client follows each to its outcome instead of giving up first.
 *
 * Every answer is parsed, not cast. A table of zeros is the known way this
 * kind of screen lies ("Nullen über Fehlermeldung"): a server that renamed a
 * field would otherwise render as "0 converted, 0 open" — a clean bill of
 * health for a run nobody can see. A shape this build does not know throws
 * `TimeMigrationContractError`, and the screen says the answer was unreadable.
 *
 * The schemas mirror `backend/src/schemas/timeMigration.ts`; the admin router
 * answers bare (ADR 0001).
 */

/** The answer arrived but is not the shape this build reads. */
export class TimeMigrationContractError extends Error {
  constructor(what: string) {
    super(`unreadable ${what} answer`);
    this.name = "TimeMigrationContractError";
  }
}

const count = z.number().int().nonnegative();
const table = z.enum(TIME_MIGRATION_TABLES);
const reason = z.enum(TIME_MIGRATION_REASONS);
const reResolveTable = z.enum([
  "flights",
  "rail_journeys",
  "place_visits",
  "cruise_stops",
  "cruises",
  "trip_stops",
  "lodging_stays",
]);

const reportSchema = z.object({
  backfill: z.object({
    state: z.enum(["pending", "running", "completed", "failed"]),
    completedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    tzdata: z.string().nullable(),
  }),
  tables: z.array(
    z.object({
      table,
      converted: count,
      open: count,
      alreadyFilled: count,
      rules: z.array(z.object({ rule: z.string(), status: z.enum(["open", "resolved"]), count })),
      reasons: z.array(z.object({ reason, count })),
    })
  ),
  unchanged: z.array(
    z.object({
      domain: z.enum(["tours", "track_windows", "loyalty", "country_days", "photos"]),
      why: z.enum(["already_dates", "already_instants", "no_time_columns", "utc_by_decision"]),
    })
  ),
  flags: z.object({
    open: count,
    resolved: count,
    dismissed: count,
    byKind: z.array(z.object({ kind: z.enum(TIME_FLAG_KINDS), open: count })),
  }),
  openRows: z.array(
    z.object({
      table,
      rowId: z.string(),
      userId: z.string().nullable(),
      column: z.string(),
      rule: z.string(),
      reason: reason.nullable(),
      legacyValue: z.string().nullable(),
      newValue: z.string().nullable(),
      zone: z.string().nullable(),
    })
  ),
  openRowsTruncated: z.boolean(),
});

const dryRunSchema = z.object({
  dryRunId: z.string().min(1),
  tzdata: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  tables: z.array(
    z.object({ table: reResolveTable, checked: count, changes: count, unresolvable: count })
  ),
  changes: z.array(
    z.object({
      table: reResolveTable,
      rowId: z.string(),
      column: z.string(),
      storedZone: z.string(),
      resolvedZone: z.string(),
      instant: z.string().nullable(),
      offsetDeltaMinutes: z.number().int().nullable(),
    })
  ),
  changesTruncated: z.boolean(),
});

const applySchema = z.object({ dryRunId: z.string(), applied: count, skippedChanged: count });

const jobStartSchema = z.object({ jobId: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new TimeMigrationContractError(what);
  return result.data;
}

type OnPoll = (job: JobView<unknown>) => void;

/** Start a job with `POST path`, follow it, and parse what it produced. */
async function runJob<T>(
  path: string,
  body: unknown,
  params: Record<string, string> | undefined,
  schema: z.ZodType<T>,
  what: string,
  onPoll?: OnPoll
): Promise<T> {
  const { data } = await api.post<unknown>(path, body, params ? { params } : undefined);
  const { jobId } = parse(jobStartSchema, data, what);
  return parse(schema, await waitForJob<unknown>(jobId, { onPoll }), what);
}

export const timeMigrationApi = {
  /** `GET /admin/time-migration/report` — what the backfill converted and left open. */
  getReport: async (): Promise<TimeMigrationReport> => {
    const { data } = await api.get<unknown>("/admin/time-migration/report");
    return parse(reportSchema, data, "report");
  },

  /**
   * `POST /admin/time-zones/re-resolve?dryRun=true` → job whose result lists
   * the rows whose stored zone the resolver would now answer differently.
   * Writes nothing.
   */
  dryRunReResolve: (onPoll?: OnPoll): Promise<ReResolveDryRun> =>
    runJob(
      "/admin/time-zones/re-resolve",
      undefined,
      { dryRun: "true" },
      dryRunSchema,
      "dry run",
      onPoll
    ),

  /**
   * `POST /admin/time-zones/re-resolve/apply` `{dryRunId}` → job. The server
   * applies exactly the changes of that dry run, so what is written is what
   * the admin read.
   */
  applyReResolve: (dryRunId: string, onPoll?: OnPoll): Promise<ReResolveApply> =>
    runJob(
      "/admin/time-zones/re-resolve/apply",
      { dryRunId },
      undefined,
      applySchema,
      "apply",
      onPoll
    ),
};

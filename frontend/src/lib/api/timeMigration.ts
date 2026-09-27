import { z } from "zod";

import { API_TIMEOUTS } from "../../config/constants";
import type {
  TimeMigrationReport,
  ZoneReResolveApplyResult,
  ZoneReResolveDryRun,
} from "../../types/timeMigrationDraft";
import { api } from "./client";
import { type JobView, waitForJob } from "./jobs";

/**
 * The admin half of the time-model migration (ADR 0002, plan Phase 3b):
 * the migration report, and the zone re-resolution (D2) as a dry run the
 * admin reads before anything is written.
 *
 * Every answer is parsed, not cast. A table of zeros is the known way this
 * kind of screen lies ("Nullen über Fehlermeldung"): a server that renamed a
 * field would otherwise render as "0 converted, 0 unresolved" — a clean bill
 * of health for a run nobody can see. A shape this build does not know throws
 * `TimeMigrationContractError`, and the screen says the answer was unreadable.
 */

/** The answer arrived but is not the shape this build reads. */
export class TimeMigrationContractError extends Error {
  constructor(what: string) {
    super(`unreadable ${what} answer`);
    this.name = "TimeMigrationContractError";
  }
}

const countSchema = z.object({
  table: z.string().min(1),
  rule: z.string().min(1),
  reason: z.string().min(1).nullable(),
  outcome: z.enum(["converted", "kept", "unresolved"]),
  count: z.number().int().nonnegative(),
});

const unresolvedRowSchema = z.object({
  table: z.string().min(1),
  entityId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  field: z.string().min(1),
  reason: z.string().min(1),
  flagId: z.string().min(1).nullable(),
  flagKind: z.enum(["time_zone_unresolved", "time_precision_unknown"]).nullable(),
  label: z.string().nullable(),
  ownerId: z.string().min(1),
  ownerUsername: z.string(),
});

const reportSchema = z.object({
  status: z.enum(["not_run", "running", "done", "failed"]),
  ranAt: z.string().nullable(),
  counts: z.array(countSchema),
  unresolved: z.array(unresolvedRowSchema),
  unresolvedTotal: z.number().int().nonnegative(),
});

const changeSchema = z.object({
  table: z.string().min(1),
  entityId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  field: z.string().min(1),
  label: z.string().nullable(),
  fromZone: z.string().min(1),
  toZone: z.string().min(1),
  at: z.string().min(1),
  offsetDeltaMinutes: z.number().int(),
});

const dryRunSchema = z.object({
  dryRunId: z.string().min(1),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  scanned: z.number().int().nonnegative(),
  changes: z.array(changeSchema),
  changesTotal: z.number().int().nonnegative(),
  unresolvable: z.number().int().nonnegative(),
});

const applyStartSchema = z.object({ jobId: z.string().min(1) });

const applyResultSchema = z.object({
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/**
 * The payload of a response, whichever family its router speaks (ADR 0001).
 * Admin routers answer bare; the job-start routes elsewhere envelope. The
 * backend half of Phase 3b picks the family — the parse after this is what
 * keeps a wrong guess from rendering as data.
 */
function payloadOf(body: unknown): unknown {
  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    "data" in body &&
    (body as { success: unknown }).success === true
  ) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(payloadOf(body));
  if (!result.success) throw new TimeMigrationContractError(what);
  return result.data;
}

export const timeMigrationApi = {
  /** `GET /admin/time-migration/report` — what the backfill converted and left. */
  getReport: async (): Promise<TimeMigrationReport> => {
    const { data } = await api.get<unknown>("/admin/time-migration/report");
    return parse(reportSchema, data, "report");
  },

  /**
   * `POST /admin/time-zones/re-resolve?dryRun=true` — the rows whose stored
   * zone the resolver would now answer differently. Writes nothing.
   */
  dryRunReResolve: async (): Promise<ZoneReResolveDryRun> => {
    const { data } = await api.post<unknown>("/admin/time-zones/re-resolve", undefined, {
      params: { dryRun: true },
      timeout: API_TIMEOUTS.ZONE_RE_RESOLVE_DRY_RUN,
    });
    return parse(dryRunSchema, data, "dry run");
  },

  /**
   * `POST /admin/time-zones/re-resolve/apply` with the dry run's id, then the
   * job's outcome. The apply refuses without an id, so what is written is
   * exactly what the admin read.
   */
  applyReResolve: async (
    dryRunId: string,
    onPoll?: (job: JobView<unknown>) => void
  ): Promise<ZoneReResolveApplyResult> => {
    const { data } = await api.post<unknown>("/admin/time-zones/re-resolve/apply", {
      dryRunId,
    });
    const { jobId } = parse(applyStartSchema, data, "apply");
    const result = await waitForJob<unknown>(jobId, { onPoll });
    return parse(applyResultSchema, result, "apply result");
  },
};

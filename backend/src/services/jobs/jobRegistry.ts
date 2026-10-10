/**
 * Background jobs for work that outlives an HTTP request (2026-09-26).
 *
 * A backup, a restore, a spreadsheet import, a photo-library scan and a
 * trip's weather fill can each run for minutes. The browser gives up on a
 * request after ten seconds, so every one of them used to report
 * "failed" while the server went on and finished — a restore that SUCCEEDED
 * was announced as a failure, and the second click met a 409 from the run
 * the first one had started. The fix is not a longer timeout but an honest
 * one: the request starts the work and answers at once with a job id, and the
 * client asks `GET /jobs/:id` until the job has an outcome.
 *
 * In memory on purpose. A restore replaces the database, rows included, so a
 * job table would be overwritten by the very job it describes; and the jobs
 * are short-lived answers to one person's click, not records. A restart loses
 * a running job's handle — the work itself is gone with the process too, so
 * the handle would only have described a job that no longer exists.
 */

import { randomUUID } from "crypto";

import { AppError } from "../../middleware/errorHandler";
import { ImmichError } from "../immich/types";
import logger from "../../utils/logger";

export type JobKind =
  | "backup.create"
  | "backup.restore"
  | "xlsx.import"
  | "photoJourneys.scan"
  | "journal.weather"
  | "timeModel.backfill"
  | "timeZones.reResolveDryRun"
  | "timeZones.reResolveApply"
  | "placeImport.resolve";

export type JobStatus = "running" | "succeeded" | "failed";

/** Why a job failed, as the client needs it: a stable code and a status. */
export interface JobError {
  /** The thrower's `ApiErrorCode` or a route-level code (e.g. `backup_failed`),
   *  else `JOB_FAILED`. The client maps this to its own copy. */
  code: string;
  /** The HTTP status the same failure would have answered synchronously. */
  status: number;
}

export interface JobView {
  id: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  /** The work's own answer; null until it has succeeded. */
  result: unknown;
  error: JobError | null;
  /** How far a job that reports it has got; null for a job that does not. */
  progress: JobProgress | null;
}

export interface JobProgress {
  done: number;
  total: number;
}

/** Handed to the work: call it as the work advances. */
export type ReportProgress = (done: number, total: number) => void;

interface JobRecord extends JobView {
  ownerId: string;
}

/** A finished job is kept this long for the client to read its outcome. */
export const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;
/** Defensive cap; a registry is not a place to accumulate history. */
const MAX_JOBS = 500;

const jobs = new Map<string, JobRecord>();

function toView(job: JobRecord): JobView {
  const { ownerId: _ownerId, ...view } = job;
  return { ...view, progress: view.progress ? { ...view.progress } : null };
}

function prune(now: number): void {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - Date.parse(job.finishedAt) > FINISHED_JOB_TTL_MS) jobs.delete(id);
  }
  // Oldest finished first when still over the cap; a running job is never dropped.
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((j) => j.finishedAt)
    .sort((a, b) => Date.parse(a.finishedAt!) - Date.parse(b.finishedAt!));
  for (const job of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
}

/**
 * The failure as the client sees it: a code, never the thrower's prose.
 *
 * An Immich failure keeps its kind (`unreachable`, `auth`, …) — the fixed
 * vocabulary every Immich error body speaks — so a photo scan run as a job
 * can say WHY the library did not answer instead of a bare "failed".
 */
export function jobErrorOf(err: unknown): JobError {
  if (err instanceof ImmichError) return { code: err.kind, status: 502 };
  if (err instanceof AppError) {
    return {
      code: err.code ?? err.message.match(/^[a-z_]+$/)?.[0] ?? "JOB_FAILED",
      status: err.statusCode,
    };
  }
  return { code: "JOB_FAILED", status: 500 };
}

/**
 * Start `work` in the background and return its handle at once. The work's
 * resolved value becomes `result`; a throw becomes `error`, and is logged with
 * its detail here, because nobody is awaiting the promise to log it.
 */
export function startJob<T>(
  kind: JobKind,
  ownerId: string,
  work: (reportProgress: ReportProgress) => Promise<T>
): JobView {
  prune(Date.now());
  const job: JobRecord = {
    id: randomUUID(),
    kind,
    ownerId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
    progress: null,
  };
  jobs.set(job.id, job);
  const reportProgress: ReportProgress = (done, total) => {
    job.progress = { done, total };
  };
  // Deferred one tick so a synchronous throw inside `work` still lands in the
  // job rather than in the request that started it.
  void Promise.resolve()
    .then(() => work(reportProgress))
    .then(
      (result) => {
        job.status = "succeeded";
        job.result = result ?? null;
      },
      (err: unknown) => {
        job.status = "failed";
        job.error = jobErrorOf(err);
        logger.error({
          operation: "background_job_failed",
          jobId: job.id,
          kind,
          code: job.error.code,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    )
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return toView(job);
}

/** The job, when it exists and belongs to `ownerId`; null otherwise — a
 *  stranger's job must look exactly like no job. */
export function getJob(id: string, ownerId: string): JobView | null {
  const job = jobs.get(id);
  return job && job.ownerId === ownerId ? toView(job) : null;
}

/** A running job of any of `kinds`, whoever started it. */
export function findRunningJob(kinds: readonly JobKind[]): JobView | null {
  for (const job of jobs.values()) {
    if (job.status === "running" && kinds.includes(job.kind)) return toView(job);
  }
  return null;
}

/** Test seam: resolves once no job is running any more. */
export async function settleAllJobs(): Promise<void> {
  while ([...jobs.values()].some((j) => j.status === "running" || !j.finishedAt)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Test seam. */
export function clearJobs(): void {
  jobs.clear();
}

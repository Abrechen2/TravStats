import { isAxiosError } from "axios";

import { apiErrorMachineCode } from "../apiError";
import { api } from "./client";

/**
 * Background jobs (2026-09-26): the client half of `GET /jobs/:id`.
 *
 * A backup, a restore, a spreadsheet import, a photo-library scan and a
 * trip's weather fill all outlive the ten-second request timeout. Each used to
 * report "failed" while the server went on and finished. Now the request
 * answers at once with a job id, and `waitForJob` asks until the job has an
 * outcome — so what the user reads is what actually happened.
 */

export type JobStatus = "running" | "succeeded" | "failed";

export interface JobView<T = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  result: T | null;
  error: { code: string; status: number } | null;
}

/** The job finished and failed. `code` is the server's stable cause. */
export class JobFailedError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
    this.name = "JobFailedError";
  }
}

/**
 * The job's outcome could not be read: the server forgot it (a restart) or
 * stopped answering. Not the same as a failure — the work may well have
 * finished — so the UI must say "unknown", never "failed".
 */
export class JobLostError extends Error {
  constructor() {
    super("job lost");
    this.name = "JobLostError";
  }
}

export const JOB_POLL_INTERVAL_MS = 1500;
/** Consecutive unreadable polls before the outcome is declared unknown. A
 *  restore replaces the database under a running server, so a few failed
 *  polls in a row are expected and must not end the wait. */
export const JOB_POLL_MAX_MISSES = 20;

export async function getJob<T>(jobId: string): Promise<JobView<T>> {
  const { data } = await api.get<{ success: boolean; data: JobView<T> }>(`/jobs/${jobId}`);
  return data.data;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until the job has an outcome. Resolves with its result, throws
 * `JobFailedError` for a failed job and `JobLostError` when the outcome can no
 * longer be learned.
 */
export async function waitForJob<T>(
  jobId: string,
  options: { intervalMs?: number; maxMisses?: number } = {}
): Promise<T> {
  const intervalMs = options.intervalMs ?? JOB_POLL_INTERVAL_MS;
  const maxMisses = options.maxMisses ?? JOB_POLL_MAX_MISSES;
  let misses = 0;
  for (;;) {
    let job: JobView<T> | null = null;
    try {
      job = await getJob<T>(jobId);
      misses = 0;
    } catch (err) {
      // 404: the server does not know the job (restarted). Anything else is
      // a poll that did not get through; the job itself is unaffected.
      if (isAxiosError(err) && err.response?.status === 404) throw new JobLostError();
      misses += 1;
      if (misses >= maxMisses) throw new JobLostError();
    }
    if (job?.status === "succeeded") return job.result as T;
    if (job?.status === "failed") {
      throw new JobFailedError(job.error?.code ?? "JOB_FAILED", job.error?.status ?? 500);
    }
    await sleep(intervalMs);
  }
}

/** The failure's stable code, from a job or a synchronous refusal alike. */
export function jobErrorCode(err: unknown): string | null {
  if (err instanceof JobFailedError) return err.code;
  return apiErrorMachineCode(err);
}

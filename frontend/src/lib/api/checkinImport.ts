/**
 * Client of POST /checkin-import (forgejo#401): a Träwelling / travelynx
 * export, read on the server, applied through the rail and bus import rules.
 * Runs as a server job, like the spreadsheet import, so a long file is not cut
 * off by the client timeout while the server goes on writing.
 */

import { isAxiosError } from "axios";
import api from "./client";
import { JobFailedError, JobLostError, waitForJob } from "./jobs";
import type { ImportOutcome } from "../xlsx/importClient";

export type CheckinSource = "travelling" | "travelynx";

/** The server's per-file record cap (`MAX_CHECKIN_RECORDS`). */
export const CHECKIN_MAX_RECORDS = 5000;
/** The server's text ceiling (`MAX_FILE_CHARS` in routes/checkinImport.ts). */
export const CHECKIN_MAX_CHARS = 8_000_000;

export type CheckinFailure =
  "tooMany" | "invalid" | "network" | "rateLimited" | "outcomeUnknown" | "failed";

/** A refusal with a fixed kind; the caller picks the sentence. */
export class CheckinImportError extends Error {
  constructor(
    public readonly kind: CheckinFailure,
    public readonly cause?: unknown
  ) {
    super(kind);
    this.name = "CheckinImportError";
  }
}

const TOO_MANY = "IMPORT_TOO_MANY_ROWS";

function classify(err: unknown, dryRun: boolean): CheckinImportError {
  if (err instanceof CheckinImportError) return err;
  // A lost job means the server stopped reporting. After a preview nothing was
  // written; after an apply rows may have been, and "failed" would invite a
  // second run over a first that succeeded.
  if (err instanceof JobLostError) {
    return new CheckinImportError(dryRun ? "network" : "outcomeUnknown", err);
  }
  if (err instanceof JobFailedError) {
    return new CheckinImportError(err.code === TOO_MANY ? "tooMany" : "failed", err);
  }
  if (isAxiosError(err)) {
    // No answer to an apply may mean the server got the request and is writing.
    if (!err.response) return new CheckinImportError(dryRun ? "network" : "outcomeUnknown", err);
    const code = (err.response.data as { code?: string } | undefined)?.code;
    if (code === TOO_MANY) return new CheckinImportError("tooMany", err);
    if (err.response.status === 429) return new CheckinImportError("rateLimited", err);
    if (err.response.status === 400) return new CheckinImportError("invalid", err);
  }
  return new CheckinImportError("failed", err);
}

export async function sendCheckinImport(
  source: CheckinSource,
  content: string,
  dryRun: boolean
): Promise<ImportOutcome> {
  try {
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>(
      "/checkin-import",
      { source, content, dryRun, background: true }
    );
    return await waitForJob<ImportOutcome>(data.data.jobId);
  } catch (err) {
    throw classify(err, dryRun);
  }
}

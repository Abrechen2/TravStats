/**
 * Client of POST /app-import (forgejo#401): a TripIt, Polarsteps, JetLovers,
 * FlightMemory or Logmyflight export, read on the server and applied through
 * the spreadsheet import's rules. The file's text travels inside the JSON
 * body, so there is no multipart upload and no content type to set.
 * Runs as a server job, like the spreadsheet import, so a long file is not cut
 * off by the client timeout while the server goes on writing.
 */

import { isAxiosError } from "axios";
import api from "./client";
import { JobFailedError, JobLostError, waitForJob } from "./jobs";
import type { ImportOutcome } from "../xlsx/importClient";

export type AppImportSource =
  "tripit" | "polarsteps" | "jetlovers" | "flightmemory" | "logmyflight";

/** The server's per-file record cap (`MAX_APP_RECORDS` in services/appImport/types.ts). */
export const APP_IMPORT_MAX_RECORDS = 5000;
/** The server's text ceiling (`MAX_FILE_CHARS` in routes/appImport.ts). */
export const APP_IMPORT_MAX_CHARS = 8_000_000;

export type AppImportFailure =
  "tooMany" | "invalid" | "network" | "rateLimited" | "outcomeUnknown" | "failed";

/** A refusal with a fixed kind; the caller picks the sentence. */
export class AppImportError extends Error {
  constructor(
    public readonly kind: AppImportFailure,
    public readonly cause?: unknown
  ) {
    super(kind);
    this.name = "AppImportError";
  }
}

const TOO_MANY = "IMPORT_TOO_MANY_ROWS";

function classify(err: unknown, dryRun: boolean): AppImportError {
  if (err instanceof AppImportError) return err;
  // A lost job means the server stopped reporting. After a preview nothing was
  // written; after an apply rows may have been, and "failed" would invite a
  // second run over a first that succeeded.
  if (err instanceof JobLostError) {
    return new AppImportError(dryRun ? "network" : "outcomeUnknown", err);
  }
  if (err instanceof JobFailedError) {
    return new AppImportError(err.code === TOO_MANY ? "tooMany" : "failed", err);
  }
  if (isAxiosError(err)) {
    // No answer to an apply may mean the server got the request and is writing.
    if (!err.response) return new AppImportError(dryRun ? "network" : "outcomeUnknown", err);
    const code = (err.response.data as { code?: string } | undefined)?.code;
    if (code === TOO_MANY) return new AppImportError("tooMany", err);
    if (err.response.status === 429) return new AppImportError("rateLimited", err);
    if (err.response.status === 400) return new AppImportError("invalid", err);
  }
  return new AppImportError("failed", err);
}

export async function sendAppImport(
  source: AppImportSource,
  content: string,
  dryRun: boolean
): Promise<ImportOutcome> {
  try {
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>("/app-import", {
      source,
      content,
      dryRun,
      background: true,
    });
    return await waitForJob<ImportOutcome>(data.data.jobId);
  } catch (err) {
    throw classify(err, dryRun);
  }
}

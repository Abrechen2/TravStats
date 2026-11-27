import { api } from "./client";
import { JobFailedError, JobLostError, jobErrorCode, waitForJob } from "./jobs";

/**
 * File imports into TravTrack (TravTrack plan E8): a GPX file goes through the
 * same ingest as the Companion's points. The upload answers with a job; the
 * import's outcome is the job's.
 */

export type TravTrackImportStatus =
  "running" | "succeeded" | "partial" | "failed" | "interrupted" | "cancelled";

/** A file import in one of these states goes on when the same file is given again. */
export const RESUMABLE_IMPORT_STATUSES: readonly TravTrackImportStatus[] = [
  "partial",
  "failed",
  "interrupted",
];

export interface TravTrackImportReport {
  read: number;
  stored: number;
  duplicate: number;
  dropped: { privacy_zone: number; deleted_range: number; invalid: number; null_island: number };
  withoutTime: number;
  /** What the file was read as (`gpx`, `google-records`, `geojson` …); absent on older imports. */
  format?: string;
  /** The failure's code, for a failed import. */
  error?: string;
  /** The run stored nothing new: every fix was a duplicate or dropped. */
  noNewPoints?: boolean;
  /** Waiting for its turn behind another account's import. */
  queued?: boolean;
}

export interface TravTrackImport {
  id: string;
  kind: "gpx" | "dawarich";
  fileName: string;
  status: TravTrackImportStatus;
  report: TravTrackImportReport | null;
  /** Points of this import stored now. */
  pointCount: number;
  /** Fixes of the file handled so far: a resume starts here. */
  cursor: number;
  fromAt: string | null;
  toAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface TravTrackImportOutcome {
  importId: string;
  /** `partial`: it stopped part-way with points stored; resume it with the same file. */
  status: "succeeded" | "partial" | "cancelled";
  report: TravTrackImportReport;
}

async function uploadAndWait(
  path: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<TravTrackImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  // The shared client sends JSON by default; naming multipart lets axios add the boundary.
  const { data } = await api.post<{ jobId: string; importId: string }>(path, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return waitForJob<TravTrackImportOutcome>(data.jobId, {
    onPoll: (job) => {
      if (job.progress && job.progress.total > 0) onProgress?.(job.progress.done);
    },
  });
}

export const travTrackImportsApi = {
  list: async (): Promise<TravTrackImport[]> =>
    (await api.get<{ imports: TravTrackImport[] }>("/travtrack/imports")).data.imports,
  /** Uploads the file and waits for the import's outcome. */
  importGpx: (file: File, onProgress?: (percent: number) => void) =>
    uploadAndWait("/travtrack/imports", file, onProgress),
  /** Gives a stopped import its file again and waits for the outcome. */
  resume: (id: string, file: File, onProgress?: (percent: number) => void) =>
    uploadAndWait(`/travtrack/imports/${encodeURIComponent(id)}/resume`, file, onProgress),
  remove: async (id: string): Promise<number> =>
    (await api.delete<{ deleted: number }>(`/travtrack/imports/${encodeURIComponent(id)}`)).data
      .deleted,
};

/**
 * The `track:` key for a failed import, upload or delete — by the server's
 * code, never its prose: a file without times, an unreadable file, an import
 * already running, a file too large, TravTrack off, an outcome lost to a
 * restart, a network failure.
 */
export function importErrorKey(err: unknown): string {
  if (err instanceof JobLostError) return "track:imports.errors.lost";
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 429) return "track:imports.errors.rateLimited";
  switch (jobErrorCode(err)) {
    case "TRAVTRACK_IMPORT_NO_TIMES":
      return "track:imports.errors.noTimes";
    case "TRAVTRACK_IMPORT_UNREADABLE":
      return "track:imports.errors.unreadable";
    case "TRAVTRACK_IMPORT_TOO_MANY_POINTS":
      return "track:imports.errors.tooManyPoints";
    case "TRAVTRACK_IMPORT_UNSUPPORTED_FORMAT":
      return "track:imports.errors.unsupportedFormat";
    case "TRAVTRACK_IMPORT_BUSY":
      return "track:imports.errors.busy";
    case "TRAVTRACK_IMPORT_RUNNING":
      return "track:imports.errors.running";
    case "TRACK_FILE_TOO_LARGE":
      return "track:imports.errors.tooLarge";
    case "TRAVTRACK_IMPORT_NOT_FOUND":
      return "track:imports.errors.notFound";
    case "TRAVTRACK_IMPORT_NOT_RESUMABLE":
      return "track:imports.errors.notResumable";
    case "TRAVTRACK_IMPORT_FILE_MISMATCH":
      return "track:imports.errors.fileMismatch";
    case "TRAVTRACK_DISABLED":
      return "track:errors.disabled";
    default:
      return status !== undefined || err instanceof JobFailedError
        ? "track:errors.generic"
        : "track:errors.network";
  }
}

/** The copy key for a stored import's failure code (`report.error`). */
export function storedImportErrorKey(code: string | undefined): string {
  switch (code) {
    case "TRAVTRACK_IMPORT_NO_TIMES":
      return "track:imports.errors.noTimes";
    case "TRAVTRACK_IMPORT_UNREADABLE":
      return "track:imports.errors.unreadable";
    case "TRAVTRACK_IMPORT_TOO_MANY_POINTS":
      return "track:imports.errors.tooManyPoints";
    case "TRAVTRACK_IMPORT_UNSUPPORTED_FORMAT":
      return "track:imports.errors.unsupportedFormat";
    default:
      return "track:errors.generic";
  }
}

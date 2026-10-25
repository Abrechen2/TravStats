import { api } from "./client";
import { JobFailedError, JobLostError, jobErrorCode, waitForJob } from "./jobs";

/**
 * File imports into TravTrack (TravTrack plan E8): a GPX file goes through the
 * same ingest as the Companion's points. The upload answers with a job; the
 * import's outcome is the job's.
 */

export type TravTrackImportStatus =
  "running" | "succeeded" | "failed" | "interrupted" | "cancelled";

export interface TravTrackImportReport {
  read: number;
  stored: number;
  duplicate: number;
  dropped: { privacy_zone: number; deleted_range: number; invalid: number; null_island: number };
  withoutTime: number;
  /** The failure's code, for a failed import. */
  error?: string;
}

export interface TravTrackImport {
  id: string;
  kind: "gpx" | "dawarich";
  fileName: string;
  status: TravTrackImportStatus;
  report: TravTrackImportReport | null;
  /** Points of this import stored now. */
  pointCount: number;
  fromAt: string | null;
  toAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface TravTrackImportOutcome {
  importId: string;
  status: "succeeded" | "cancelled";
  report: TravTrackImportReport;
}

export const travTrackImportsApi = {
  list: async (): Promise<TravTrackImport[]> =>
    (await api.get<{ imports: TravTrackImport[] }>("/travtrack/imports")).data.imports,
  /** Uploads the file and waits for the import's outcome. */
  importGpx: async (file: File): Promise<TravTrackImportOutcome> => {
    const form = new FormData();
    form.append("file", file);
    // The shared client sends JSON by default; naming multipart lets axios add the boundary.
    const { data } = await api.post<{ jobId: string; importId: string }>(
      "/travtrack/imports",
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return waitForJob<TravTrackImportOutcome>(data.jobId);
  },
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
    case "TRAVTRACK_IMPORT_RUNNING":
      return "track:imports.errors.running";
    case "TRACK_FILE_TOO_LARGE":
      return "track:imports.errors.tooLarge";
    case "TRAVTRACK_IMPORT_NOT_FOUND":
      return "track:imports.errors.notFound";
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
    default:
      return "track:errors.generic";
  }
}

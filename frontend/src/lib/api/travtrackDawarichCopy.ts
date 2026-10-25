import { api } from "./client";
import { jobErrorCode } from "./jobs";

/**
 * Copying the account's own Dawarich history into TravTrack (TravTrack plan
 * L6). Started, resumed and stopped by the user only; Dawarich is only read.
 * The copy's state is the server's (`GET /travtrack/imports/dawarich`), which
 * the client polls while it runs — the job is only the handle for the click.
 */

export type DawarichCopyStatus =
  "running" | "paused" | "interrupted" | "complete" | "incomplete" | "failed" | "cancelled";

export type DawarichCopyErrorKind =
  | "unreachable"
  | "auth"
  | "notFound"
  | "protocol"
  | "invalidUrl"
  | "disabled"
  | "notConfigured"
  | "internal";

export interface DawarichCopyDropped {
  privacy_zone: number;
  deleted_range: number;
  invalid: number;
  null_island: number;
}

export interface DawarichCopyMonth {
  month: string;
  read: number;
  stored: number;
  duplicate: number;
  dropped: DawarichCopyDropped;
  truncatedHours: string[];
  unreachableDays: string[];
  daysWithPoints: number;
}

export interface DawarichCopyTotals {
  read: number;
  stored: number;
  duplicate: number;
  dropped: DawarichCopyDropped;
  truncatedHours: number;
  unreachableDays: number;
  daysWithPoints: number;
}

export interface DawarichCopy {
  importId: string;
  status: DawarichCopyStatus;
  fromDay: string;
  untilDay: string;
  nextDay: string;
  daysDone: number;
  daysTotal: number;
  lastErrorKind: DawarichCopyErrorKind | null;
  createdAt: string;
  finishedAt: string | null;
  totals: DawarichCopyTotals;
  months: DawarichCopyMonth[];
}

export interface DawarichCopyState {
  /** `shared`: only the server's Dawarich connection, which a copy never uses. */
  connection: "own" | "shared" | "none";
  copy: DawarichCopy | null;
}

const BASE = "/travtrack/imports/dawarich";

export const dawarichCopyApi = {
  get: async (): Promise<DawarichCopyState> => (await api.get<DawarichCopyState>(BASE)).data,
  /** Both days (UTC, inclusive) or neither: neither copies the whole history. */
  start: async (range: { fromDay: string; untilDay: string } | null): Promise<void> => {
    await api.post(BASE, range ?? {});
  },
  resume: async (): Promise<void> => {
    await api.post(`${BASE}/resume`);
  },
  stop: async (): Promise<DawarichCopyState> =>
    (await api.post<DawarichCopyState>(`${BASE}/stop`)).data,
};

/** The `track:` key for a refused start, resume or stop — by the server's code, never its prose. */
export function dawarichCopyErrorKey(err: unknown): string {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 429) return "track:dawarichCopy.errors.rateLimited";
  switch (jobErrorCode(err)) {
    case "DAWARICH_NOT_CONFIGURED":
      return "track:dawarichCopy.errors.notConfigured";
    case "TRAVTRACK_IMPORT_RUNNING":
      return "track:dawarichCopy.errors.running";
    case "TRAVTRACK_IMPORT_NOT_RUNNING":
      return "track:dawarichCopy.errors.notRunning";
    case "TRAVTRACK_IMPORT_NOT_RESUMABLE":
    case "TRAVTRACK_IMPORT_NOT_FOUND":
      return "track:dawarichCopy.errors.notResumable";
    case "VALIDATION_FAILED":
      return "track:dawarichCopy.errors.range";
    case "TRAVTRACK_DISABLED":
      return "track:errors.disabled";
    default:
      return status !== undefined ? "track:errors.generic" : "track:errors.network";
  }
}

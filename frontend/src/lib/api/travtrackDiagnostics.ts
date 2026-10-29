import { api } from "./client";

/**
 * The TravTrack diagnostics log (spec 2026-10-29-travtrack-diagnostics): one
 * device's day lined up with its stored points, the raw export, delete. The
 * phone writes the log; the web only reads it.
 */

export type DiagnosticsGapCause =
  | "reportedGap"
  | "permission"
  | "recorderPaused"
  | "lostAfterUpload"
  | "uploadFailed"
  | "notUploaded"
  | "droppedOnPhone"
  | "appNotRunning"
  | "noLog"
  | "unexplained";

export interface DiagnosticsDevice {
  deviceId: string;
  label: string | null;
  model: string | null;
  os: string | null;
  appVersion: string | null;
  events: number;
  points: number;
}

export interface DiagnosticsGap {
  from: string;
  to: string;
  minutes: number;
  cause: DiagnosticsGapCause;
  evidence: {
    fixesReceived: number;
    fixesKept: number;
    dropped: Record<string, number>;
    uploads: { uploadId: string; status: number | null; received: boolean }[];
    permission: string | null;
    recorder: string | null;
    lifecycle: string | null;
    reportedReason: string | null;
  };
}

export interface DiagnosticsEvent {
  id: string;
  t: string;
  kind: string;
  data: Record<string, unknown>;
}

export interface DiagnosticsDay {
  date: string;
  zone: string;
  from: string;
  until: string;
  deviceId: string | null;
  devices: DiagnosticsDevice[];
  hasLog: boolean;
  pointsPerMinute: { t: string; n: number }[];
  fixesPerMinute: { t: string; received: number; kept: number; dropped: Record<string, number> }[];
  events: DiagnosticsEvent[];
  eventsTruncated: boolean;
  carried: { permission?: string; recorder?: string; lifecycle?: string };
  gaps: DiagnosticsGap[];
}

export const travTrackDiagnosticsApi = {
  day: async (date: string, deviceId?: string): Promise<DiagnosticsDay> =>
    (
      await api.get<DiagnosticsDay>("/travtrack/diagnostics/day", {
        params: deviceId ? { date, deviceId } : { date },
      })
    ).data,
  /** The raw log of a span as a file's content. */
  exportBlob: async (from: string, to: string, deviceId?: string): Promise<Blob> =>
    (
      await api.get<Blob>("/travtrack/diagnostics/export", {
        params: deviceId ? { from, to, deviceId } : { from, to },
        responseType: "blob",
      })
    ).data,
  deleteAll: async (): Promise<number> =>
    (await api.delete<{ deleted: number }>("/travtrack/diagnostics")).data.deleted,
};

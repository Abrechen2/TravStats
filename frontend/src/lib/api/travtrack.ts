import { api } from "./client";
import { apiErrorMachineCode } from "../apiError";

/**
 * TravTrack, the own location history (TravTrack plan, phase 2): what it does
 * on this server for this account, and the admin's instance switch.
 */

export interface TravTrackCapabilities {
  version: 1;
  /** The beta switch offers TravTrack on this server. */
  offered: boolean;
  /** The instance captures and shows TravTrack (beta switch + admin switch). */
  enabled: boolean;
  /** This account's location provider is TravTrack and it works. */
  active: boolean;
  /** This account holds TravTrack data: summary, export and delete stay reachable. */
  hasData: boolean;
}

export interface TravTrackConfig {
  enabled: boolean;
}

/** What is stored — of everything, or of one span (a delete's preview). */
export interface TravTrackSummary {
  pointCount: number;
  firstAt: string | null;
  lastAt: string | null;
  lastReceivedAt: string | null;
  devices: Array<{ deviceId: string | null; pointCount: number }>;
  deletedRanges: number;
  zones: number;
}

export interface PrivacyZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface PrivacyZoneInput {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** The user saw how many stored positions the zone deletes and agreed. */
  deleteStoredPoints?: boolean;
}

/** `[tMs, lat, lon, accuracyM]`, as the server stores a fix. */
export type TrackPoint = [number, number, number, number | null];

export type TrackCoverageState = "recorded" | "noData" | "deleted" | "phonePaused";

export interface TravTrackDay {
  date: string;
  /** The profile zone the day is read on. */
  zone: string;
  /** Stretches already cut at every gap and privacy-cut — never join two. */
  segments: TrackPoint[][];
  coverage: Array<{ fromMs: number; untilMs: number; state: TrackCoverageState }>;
  context: Array<{
    kind: "flight" | "trip" | "home";
    id: string | null;
    label: string;
    fromMs: number;
    untilMs: number;
  }>;
  pointCount: number;
  truncated: boolean;
}

export type TravTrackExportFormat = "gpx" | "json";

/** A span of days, both inclusive, on the profile's clock. */
export interface DaySpan {
  fromDay: string;
  toDay: string;
}

/** A 409 with this code names `pointsInside`: ask, then send again with `deleteStoredPoints`. */
export const ZONE_HOLDS_POINTS = "LOCATION_ZONE_HOLDS_POINTS";

function filenameFrom(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export const travTrackApi = {
  capabilities: async (): Promise<TravTrackCapabilities> =>
    (await api.get<TravTrackCapabilities>("/travtrack/capabilities")).data,
  config: async (): Promise<TravTrackConfig> =>
    (await api.get<TravTrackConfig>("/travtrack/config")).data,
  setConfig: async (config: TravTrackConfig): Promise<TravTrackConfig> =>
    (await api.patch<TravTrackConfig>("/travtrack/config", config)).data,
  /** Everything stored, or — with a span — what deleting that span would delete. */
  summary: async (span?: DaySpan): Promise<TravTrackSummary> =>
    (await api.get<TravTrackSummary>("/travtrack/summary", span ? { params: span } : undefined))
      .data,
  zones: async (): Promise<PrivacyZone[]> =>
    (await api.get<{ zones: PrivacyZone[] }>("/travtrack/zones")).data.zones,
  createZone: async (input: PrivacyZoneInput): Promise<{ zone: PrivacyZone; deleted: number }> =>
    (await api.post<{ zone: PrivacyZone; deleted: number }>("/travtrack/zones", input)).data,
  deleteZone: async (id: string): Promise<void> => {
    await api.delete(`/travtrack/zones/${encodeURIComponent(id)}`);
  },
  /** Both days inclusive, on the profile's clock; the count deleted. */
  deleteDays: async (span: DaySpan): Promise<number> =>
    (await api.delete<{ deleted: number }>("/travtrack/points", { params: span })).data.deleted,
  day: async (date: string): Promise<TravTrackDay> =>
    (await api.get<TravTrackDay>("/travtrack/day", { params: { date } })).data,
  exportFile: async (
    span: DaySpan,
    format: TravTrackExportFormat
  ): Promise<{ blob: Blob; filename: string; truncated: boolean }> => {
    const res = await api
      .get<Blob>("/travtrack/export", { params: { ...span, format }, responseType: "blob" })
      .catch(async (err: unknown) => {
        throw await withJsonBody(err);
      });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], `travtrack.${format}`),
      truncated: res.headers["x-travtrack-coverage"] === "truncated",
    };
  },
};

/**
 * A refused blob request carries its error body as a Blob; read it as JSON so
 * its `code` can be recognised like any other answer's.
 */
async function withJsonBody(err: unknown): Promise<unknown> {
  const response = (err as { response?: { data?: unknown } } | null)?.response;
  if (!response || !(response.data instanceof Blob)) return err;
  try {
    const data = JSON.parse(await response.data.text()) as unknown;
    return Object.assign(new Error("TravTrack export refused"), {
      response: { ...response, data },
    });
  } catch {
    return err; // Not JSON: the error stays as it came.
  }
}

/** How many stored positions a refused zone would delete; null for any other refusal. */
export function pointsInsideOf(err: unknown): number | null {
  const data = (
    err as { response?: { status?: number; data?: { code?: unknown; pointsInside?: unknown } } }
  )?.response;
  return data?.status === 409 &&
    data.data?.code === ZONE_HOLDS_POINTS &&
    typeof data.data.pointsInside === "number"
    ? data.data.pointsInside
    : null;
}

/**
 * The `track:` key for a failed TravTrack read or write: a refusal by name
 * (TravTrack switched off, a span too long to export), a network failure as
 * one, anything else generic. Never the server's prose, never a raw code.
 */
export function trackErrorKey(err: unknown): string {
  switch (apiErrorMachineCode(err)) {
    case "TRAVTRACK_DISABLED":
      return "track:errors.disabled";
    case "TRAVTRACK_EXPORT_TOO_LONG":
      return "track:errors.exportTooLong";
    case "LOCATION_ZONE_LIMIT":
      return "track:errors.zoneLimit";
    default:
      return (err as { response?: unknown } | null)?.response
        ? "track:errors.generic"
        : "track:errors.network";
  }
}

/** The i18n key for a failed TravTrack call; a refusal by name, anything else generic. */
export function travTrackErrorKey(err: unknown): string {
  switch (apiErrorMachineCode(err)) {
    case "TRAVTRACK_DISABLED":
      return "admin:travTrack.errors.disabled";
    default:
      return "admin:travTrack.errors.saveFailed";
  }
}

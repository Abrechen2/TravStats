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
  /** Where this server takes positions from (plan E9); absent on an older server. */
  sources?: Array<"companion" | "gpx" | "owntracks" | "overland">;
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

/** Two instants, `[from, to)` — how the rest of a truncated export is asked for. */
export interface InstantSpan {
  from: string;
  to: string;
}

/** One file of an export; `rest` is the span still to fetch when the file ended early. */
export interface TravTrackExportPart {
  blob: Blob;
  filename: string;
  truncated: boolean;
  rest: ExportContinuation | null;
}

/**
 * The rest of a truncated export: its span and the last point given
 * (`<tMs>:<seq>`), so points sharing an instant at the part's end are
 * neither repeated nor lost.
 */
export interface ExportContinuation extends InstantSpan {
  cursor: string;
}

/** A shared trip's route as its recipients see it (plan T7): geometry only. */
export interface TripRouteSnapshot {
  version: number;
  pointCount: number;
  createdAt: string;
  geometry: Array<Array<[number, number]>>;
}

/** A route another member of a shared trip shares with the reader: geometry and a name only. */
export interface SharedTripRoute {
  version: number;
  /** The sharer's display name, for the map's label. */
  sharedBy: string;
  geometry: Array<Array<[number, number]>>;
}

/** The answer when nobody shares a route of this trip with the reader. */
export const SHARED_ROUTE_NOT_FOUND = "SHARED_ROUTE_NOT_FOUND";

/** A 409 with this code names `pointsInside`: ask, then send again with `deleteStoredPoints`. */
export const ZONE_HOLDS_POINTS = "LOCATION_ZONE_HOLDS_POINTS";

function filenameFrom(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

/** A Web-Mercator tile at zoom 14, `[x, y]` — the explored map's one resolution. */
export type ExploredCell = [number, number];
/** A map box in degrees; west > east crosses the antimeridian. */
export type ExploredBox = { west: number; south: number; east: number; north: number };

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
  /** The explored zoom-14 tiles in a box (plan L1); zones drawn as explored ground. */
  explored: async (box: ExploredBox): Promise<ExploredCell[]> =>
    (
      await api.get<{ cells: ExploredCell[] }>("/travtrack/explored", {
        params: { bbox: [box.west, box.south, box.east, box.north].join(",") },
      })
    ).data.cells,
  /** What of a trip's route is shared, or null while nothing is. */
  routeSnapshot: async (tripId: string): Promise<TripRouteSnapshot | null> =>
    (
      await api.get<{ snapshot: TripRouteSnapshot | null }>(
        `/trips/${encodeURIComponent(tripId)}/share-snapshot`
      )
    ).data.snapshot,
  /** Shares the trip's route, or rebuilds it from what TravTrack holds now. */
  shareRoute: async (tripId: string): Promise<TripRouteSnapshot> =>
    (
      await api.put<{ snapshot: TripRouteSnapshot }>(
        `/trips/${encodeURIComponent(tripId)}/share-snapshot`
      )
    ).data.snapshot,
  /**
   * The routes the trip's other members share with the reader, read through
   * the reader's own copy. Nobody sharing one is an empty list, not a failure.
   */
  sharedRoutes: async (tripId: string): Promise<SharedTripRoute[]> => {
    try {
      return (
        await api.get<{ routes: SharedTripRoute[] }>(
          `/trips/${encodeURIComponent(tripId)}/shared-route`
        )
      ).data.routes;
    } catch (err: unknown) {
      if (apiErrorMachineCode(err) === SHARED_ROUTE_NOT_FOUND) return [];
      throw err;
    }
  },
  /** Takes the shared route back, for every recipient at once. */
  revokeRoute: async (tripId: string): Promise<void> => {
    await api.delete(`/trips/${encodeURIComponent(tripId)}/share-snapshot`);
  },
  /**
   * One file of a span. A span over the server's point cap comes in parts:
   * the answer then names the rest (`X-TravTrack-Next` / `X-TravTrack-Until`
   * / `X-TravTrack-Cursor`), which is asked for as an `ExportContinuation` —
   * so a single instant over the cap still comes out whole, each point once.
   */
  exportFile: async (
    span: DaySpan | InstantSpan | ExportContinuation,
    format: TravTrackExportFormat
  ): Promise<TravTrackExportPart> => {
    const res = await api
      .get<Blob>("/travtrack/export", { params: { ...span, format }, responseType: "blob" })
      .catch(async (err: unknown) => {
        throw await withJsonBody(err);
      });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], `travtrack.${format}`),
      truncated: res.headers["x-travtrack-coverage"] === "truncated",
      rest: restOf(
        res.headers["x-travtrack-next"],
        res.headers["x-travtrack-until"],
        res.headers["x-travtrack-cursor"]
      ),
    };
  },
};

const present = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Null unless all three are named: a rest by time alone would repeat an instant. */
function restOf(next: unknown, until: unknown, cursor: unknown): ExportContinuation | null {
  return present(next) && present(until) && present(cursor)
    ? { from: next, to: until, cursor }
    : null;
}

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
    case "TRAVTRACK_EXPLORED_ZOOM_IN":
      return "track:explored.zoomIn";
    case "TRAVTRACK_EXPLORED_UNAVAILABLE":
      return "track:explored.unavailable";
    case "LOCATION_ZONE_LIMIT":
      return "track:errors.zoneLimit";
    default:
      return (err as { response?: unknown } | null)?.response
        ? "track:errors.generic"
        : "track:errors.network";
  }
}

/** The share was revoked while it was being built: nothing of this trip's route is shared now. */
export function routeShareWasRevoked(err: unknown): boolean {
  return apiErrorMachineCode(err) === "TRAVTRACK_SHARE_REVOKED";
}

/** The i18n key for a failed route-sharing call (plan T7). */
export function routeShareErrorKey(err: unknown): string {
  switch (apiErrorMachineCode(err)) {
    case "TRAVTRACK_ROUTE_EMPTY":
      return "sharing:route.errors.empty";
    case "TRAVTRACK_DISABLED":
      return "sharing:route.errors.disabled";
    case "TRAVTRACK_ROUTE_BUILD_RATE_LIMITED":
      return "sharing:route.errors.rateLimited";
    case "TRAVTRACK_SHARE_BUSY":
      return "sharing:route.errors.busy";
    case "TRAVTRACK_SHARE_REVOKED":
      return "sharing:route.errors.revoked";
    default:
      return (err as { response?: unknown } | null)?.response
        ? "sharing:route.errors.generic"
        : "sharing:route.errors.network";
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

import { api } from "./client";
import { apiErrorMachineCode } from "../apiError";
import type { TravTrackLeg, TravTrackPointDetail, TravTrackStop } from "./travtrackLegs";
import type { BridgeLine, DaySourceSummary, EstimatedGap } from "./travtrackDaySources";

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
  /** The day-by-day derivation behind the calendar and the country days. */
  derivation: { pendingDays: number; totalDays: number; estimateMinutes: number };
}

/** „Zuletzt gesehen" (plan L2): the newest real, privacy-safe fix of the own history. */
export interface TravTrackLastSeen {
  at: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  deviceId: string | null;
  /** The paired phone's, the file's or the live source's own name; null when none is known. */
  deviceLabel: string | null;
  origin: string;
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

/** `entry`: a silence a logbook entry (`TrackCoveragePiece.entry`) explains; older servers never send it. */
export type TrackCoverageState =
  "recorded" | "noData" | "deleted" | "phonePaused" | "entry" | "stationary";

/** Why a `noData` silence was not explained by standing still; absent on older servers. */
export type TrackSilenceReason = "openEnd" | "differentPlaces" | "outsidePlaces" | "contradicted";

export interface TrackCoveragePiece {
  fromMs: number;
  untilMs: number;
  state: TrackCoverageState;
  /** On `entry` only: the logbook entry explaining the silence (`domain` = a `context` entry's `kind`). */
  entry?: { domain: string; id: string };
  /** On `stationary` only: the known place the silence was spent at. Inferred — no points exist. */
  place?: {
    id: string;
    kind: "home" | "work" | "custom" | "place";
    name: string;
    lat: number;
    lon: number;
  };
  /** On `noData` only. */
  why?: TrackSilenceReason;
}

/**
 * One label of a day (TravTrack plan E10): a TravStats record — a domain's
 * entry (`kind` is its domain key; the server may know domains this build
 * does not), a trip, time at home — an open TravTrack question (`suggestion`,
 * linked to its inbox card), or a moving stretch no entry covers
 * (`movement`, `unlabelled: true`, never with a mode).
 */
export interface TravTrackDayEntry {
  kind: string;
  id: string | null;
  /** The record's own name; empty when it has none. */
  label: string;
  /** The page the label opens, or null. */
  href: string | null;
  /** Where the label sits on the map; null rather than a point in a privacy zone. */
  anchor: { lat: number; lon: number } | null;
  unlabelled: boolean;
  suggestion?: "stay" | "journey";
  /** `stationary` entries: inferred from standing at a known place, never recorded points. */
  inferred?: true;
  fromMs: number;
  untilMs: number;
}

export interface TravTrackDay {
  date: string;
  /** The profile zone the day is read on. */
  zone: string;
  /** Stretches already cut at every gap and privacy-cut — never join two. */
  segments: TrackPoint[][];
  /** The stored point of each vertex, aligned with `segments`; absent on an older server. */
  pointIds?: string[][];
  coverage: TrackCoveragePiece[];
  context: TravTrackDayEntry[];
  /** No home is known and a silence began and ended at this spot; absent on an older server. */
  homeSuggestion?: { lat: number; lon: number; fromMs: number; untilMs: number } | null;
  pointCount: number;
  truncated: boolean;
  /** Journeys and dwells (spec 2026-11-03-travtrack-legs); absent on an older server. */
  legs?: TravTrackLeg[];
  stops?: TravTrackStop[];
  /** Speed, altitude and motion of each vertex, aligned with `segments`; absent on an older server. */
  pointDetails?: TravTrackPointDetail[][];
  /**
   * Why the day may draw fewer points than were stored: counts of fixes the privacy cut hid and
   * fixes left out as implausible; absent on an older server (then the reason is unknown).
   */
  omitted?: { privacyZone: number; implausible: number; sourceExcluded?: number };
  /** Which source the day is drawn from (best source per day); absent on an older server. */
  sources?: DaySourceSummary;
  /** Long silences drawn dashed as estimated, never counted; absent on an older server. */
  estimated?: EstimatedGap[];
  /** Jumps and gaps a logged entry explains, drawn with its line; absent on an older server. */
  bridgeLines?: BridgeLine[];
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
  /** Edit a zone; moving it over stored positions asks like adding one does. */
  updateZone: async (
    id: string,
    input: Partial<PrivacyZoneInput>
  ): Promise<{ zone: PrivacyZone; deleted: number }> =>
    (
      await api.patch<{ zone: PrivacyZone; deleted: number }>(
        `/travtrack/zones/${encodeURIComponent(id)}`,
        input
      )
    ).data,
  deleteZone: async (id: string): Promise<void> => {
    await api.delete(`/travtrack/zones/${encodeURIComponent(id)}`);
  },
  /** Both days inclusive, on the profile's clock; the count deleted. */
  deleteDays: async (span: DaySpan): Promise<number> =>
    (await api.delete<{ deleted: number }>("/travtrack/points", { params: span })).data.deleted,
  /** The last position, or null while the history holds none. */
  /** Every point of one stretch (`[fromMs, untilMs]`, the end included); the count deleted. */
  deleteSpan: async (span: { fromMs: number; untilMs: number }): Promise<number> =>
    (
      await api.delete<{ deleted: number }>("/travtrack/points", {
        params: {
          from: new Date(span.fromMs).toISOString(),
          to: new Date(span.untilMs + 1).toISOString(),
        },
      })
    ).data.deleted,

  lastSeen: async (): Promise<TravTrackLastSeen | null> =>
    (await api.get<{ lastSeen: TravTrackLastSeen | null }>("/travtrack/last-seen")).data.lastSeen,
  /** `includeImplausible` also draws the coarse fixes normally left out; the privacy cut still holds. */
  day: async (date: string, includeImplausible = false): Promise<TravTrackDay> =>
    (
      await api.get<TravTrackDay>("/travtrack/day", {
        params: includeImplausible ? { date, includeImplausible: 1 } : { date },
      })
    ).data,
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
    case "TRAVTRACK_RANGE_TOO_LONG":
      return "track:errors.rangeTooLong";
    case "TRAVTRACK_POINT_NOT_FOUND":
      return "track:errors.pointGone";
    case "TRAVTRACK_LEG_INVALID":
      return "track:errors.legInvalid";
    case "TRAVTRACK_LEG_NOT_FOUND":
      return "track:errors.legGone";
    case "TRAVTRACK_STOP_INVALID":
      return "track:errors.stopInvalid";
    case "TRAVTRACK_STOP_NOT_FOUND":
      return "track:errors.stopGone";
    case "TRAVTRACK_EXPLORED_ZOOM_IN":
      return "track:explored.zoomIn";
    case "TRAVTRACK_EXPLORED_UNAVAILABLE":
      return "track:explored.unavailable";
    case "TRAVTRACK_EXPLORED_PREPARING":
      return "track:explored.preparing";
    case "LOCATION_ZONE_LIMIT":
      return "track:errors.zoneLimit";
    case "TRAVTRACK_SOURCE_NOT_ON_DAY":
      return "track:errors.sourceNotOnDay";
    case "TRAVTRACK_DAY_NO_POINTS":
      return "track:errors.dayNoPoints";
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

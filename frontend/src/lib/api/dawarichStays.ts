import type { TimeValue } from "../../shared/time/wire";
import { api } from "./client";
import { API_TIMEOUTS } from "../../config/constants";
import { waitForJob } from "./jobs";
export interface StayScanState {
  enabled: boolean;
  connected: boolean;
  /** Present only when the scan reads TravTrack; absent, it reads the own Dawarich connection. */
  source?: "travtrack";
  marketEnabled?: boolean;
  venueEnabled?: boolean;
  marketResult?: {
    scope?: "markets" | "venues";
    status: "complete" | "partial" | "cancelled";
    tiles: number;
    totalTiles: number;
    failedTiles: number;
    missingAreaCount: number;
    invalidAreaCount: number;
    alreadyRecordedCount: number;
    createdCount: number;
    limited: boolean;
    /** The cache/fetch split is never sent: the tile cache is shared by every account. */
    staleMapData: boolean;
  } | null;
  placesEnabled?: boolean;
  pausedReason?:
    | "suggestionsDisabled"
    | "disabled"
    | "placesDisabled"
    | "connectionMissing"
    | "travTrackDisabled"
    | null;
  nextScanAt?: string | null;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  dataThrough: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  pointCount: number;
  createdCount: number;
}
export interface DawarichStay {
  times?: Record<
    "startAt" | "endAt" | "sourceStartAt" | "sourceEndAt" | "detectedAt" | "resolvedAt",
    TimeValue | null
  >;
  id: string;
  /** `accepting`: a TravTrack finding mid-accept; still offered. `invalidated`: its history went. */
  status: "pending" | "accepting" | "accepted" | "rejected" | "covered" | "invalidated";
  /** Only on a TravTrack finding made before the account's last source switch. */
  beforeSourceSwitch?: true;
  name: string | null;
  startAt: string;
  endAt: string;
  zone: string;
  lat: number;
  lon: number;
  sourceStartAt: string;
  sourceEndAt: string;
  sourceLat: number;
  sourceLon: number;
  pointCount: number;
  placeId: string | null;
  tripId: string | null;
  visitId: string | null;
  visit: { id: string; placeId: string } | null;
  detectedAt: string;
  resolvedAt: string | null;
  evidence: {
    source: "dawarich" | "travtrack";
    kind?: "market" | "venue";
    market?: {
      identity: string;
      venueType?: "market" | "mall" | "park" | "zoo" | "themePark" | "museum";
      areaIds: string[];
      sourceUrls: string[];
      interiorPointCount: number;
      overlappingMarketIds: string[];
    };
    matchingVisitId?: string | null;
    /** Set when the finding was resolved because a recorded visit or hotel stay already holds it. */
    coveredBy?: {
      kind: "visit" | "lodging";
      id: string;
      placeId?: string;
      lodgingId?: string;
      name: string;
      distanceM: number;
    };
    zone: string;
    /** Dawarich only: a TravTrack finding names its points by server-side digests. */
    pointIds?: number[];
    maxGapMinutes: number;
    uncertainties: string[];
    /** TravTrack only: why the finding was made, as a stable code and scalar params. */
    explanation?: { code: string; params: Record<string, number | string> };
    readCoverage?: "complete" | "truncated" | "unreachable";
  };
}
export interface StayChoices {
  places: { id: string; name: string; lat: number; lon: number }[];
  trips: { id: string; name: string }[];
}
export interface StayReviewInput {
  name: string;
  placeId: string | null;
  tripId: string | null;
  lat: number;
  lon: number;
  startAt: { local: string };
  endAt: { local: string };
}
/** Where a stay's identity source stands; `degraded` = the lookup failed, not "nothing here". */
export type StaySourceState = "ok" | "empty" | "degraded";
export type StayPhotoState =
  "off" | "notConfigured" | "ok" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";
export interface StayCandidate {
  name: string;
  type: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lon: number;
  distanceM: number;
  /** Photos of the stay taken at this place; null without photo evidence. */
  photoCount: number | null;
}
/** `GET /dawarich-stays/:id/identity` (forgejo#305). */
export interface StayIdentity {
  lat: number;
  lon: number;
  probable: {
    name: string;
    source: "nearbyPlace" | "address" | "photos";
    photoSupported: boolean;
  } | null;
  address: { address: string | null; city: string | null; country: string | null } | null;
  geocoder: StaySourceState;
  candidates: StayCandidate[];
  candidatesState: StaySourceState;
  photos: {
    state: StayPhotoState;
    count: number;
    cities: { name: string; count: number }[];
    truncated: boolean;
  };
  placeTypeAvailable: boolean;
}
export const STAY_PLACE_TYPES = [
  "restaurant",
  "cafe",
  "bar",
  "accommodation",
  "shop",
  "museum",
  "attraction",
  "park",
  "nature",
  "beach",
  "religious",
  "transport",
  "venue",
  "sport",
  "residential",
  "workplace",
  "other",
] as const;
export type StayPlaceType = (typeof STAY_PLACE_TYPES)[number];
/** `GET /dawarich-stays/:id/place-type`: every way it can end is its own state. */
export type StayPlaceTypeResult =
  | { state: "off" }
  | { state: "noCandidates" }
  | {
      state: "refused";
      refusal: "disabled_by_admin" | "shared_demo" | "cloud_not_consented" | "provider_incomplete";
    }
  | { state: "failed"; failure: "timeout" | "unavailable" | "unusable" }
  | {
      state: "ok";
      type: StayPlaceType;
      provider: { kind: string; isCloud: boolean; host: string | null };
    };
const base = "/dawarich-stays";
export const dawarichStaysApi = {
  state: async (): Promise<StayScanState> => (await api.get(`${base}/settings`)).data.data,
  enable: async (enabled: boolean): Promise<void> => {
    await api.patch(`${base}/settings`, { enabled });
  },
  enableMarkets: async (marketEnabled: boolean): Promise<void> => {
    await api.patch(`${base}/settings`, { marketEnabled });
  },
  enableVenues: async (venueEnabled: boolean): Promise<void> => {
    await api.patch(`${base}/settings`, { venueEnabled });
  },
  scan: async (lookbackDays = 7): Promise<void> => {
    const { data } = await api.post(`${base}/scan`, { lookbackDays });
    await waitForJob(data.data.jobId);
  },
  list: async (status: string): Promise<DawarichStay[]> =>
    (await api.get(base, { params: { status } })).data.data,
  choices: async (): Promise<StayChoices> => (await api.get(`${base}/choices`)).data.data,
  accept: async (id: string, input: StayReviewInput): Promise<void> => {
    await api.post(`${base}/${id}/accept`, input);
  },
  identity: async (id: string): Promise<StayIdentity> =>
    (await api.get(`${base}/${id}/identity`, { timeout: API_TIMEOUTS.STAY_IDENTITY })).data.data,
  placeType: async (id: string): Promise<StayPlaceTypeResult> =>
    (await api.get(`${base}/${id}/place-type`, { timeout: API_TIMEOUTS.STAY_PLACE_TYPE })).data
      .data,
  reject: async (id: string): Promise<void> => {
    await api.post(`${base}/${id}/reject`, {});
  },
};

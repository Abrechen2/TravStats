import type { UseConfirmation } from "./serviceUse";
import type { TimeValue } from "../../shared/time/wire";
import { api } from "./client";
import { API_TIMEOUTS } from "../../config/constants";
import { waitForJob, type JobView } from "./jobs";
export interface StayScanState {
  enabled: boolean;
  connected: boolean;
  /** Present only when the scan reads TravTrack; absent, it reads the own Dawarich connection. */
  source?: "travtrack";
  /**
   * TravTrack only: the venue lookup behind stop suggestions did not answer; it asks
   * again at this time (ISO instant). Absent while it works.
   */
  visitLookupRetryAt?: string;
  /** Stops waiting for the venue lookup; present with `visitLookupRetryAt`. */
  visitLookupWaiting?: number;
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
export interface StaySource {
  kind: "smartList" | "plugin" | "calendar" | "travtrack" | "dawarich";
  id: string | null;
  name: string | null;
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
  /** Where the finding came from, most specific first (2026-11-26); absent on older servers. */
  source?: StaySource;
  sources?: StaySource[];
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
      kind: "visit" | "lodging" | "flight";
      id: string;
      placeId?: string;
      lodgingId?: string;
      name: string;
      distanceM: number;
      day?: string;
    };
    zone: string;
    /** Dawarich only: a TravTrack finding names its points by server-side digests. */
    pointIds?: number[];
    maxGapMinutes: number;
    uncertainties: string[];
    /** TravTrack only: why the finding was made, as a stable code and scalar params. */
    explanation?: { code: string; params: Record<string, number | string> };
    readCoverage?: "complete" | "truncated" | "unreachable";
    /**
     * TravTrack only: a finding read from a derived stop (not the stay detector) carries the stop's
     * observed and assumed time and the building chosen, with its sub-venue as an alternative.
     */
    visit?: {
      durationMs: number;
      observedMs: number;
      inferredMs: number;
      /** null: a stop with no venue that a calendar event placed (`createdFrom: "calendar"`). */
      venue: {
        name: string;
        source: "known" | "osm";
        osmRef: string | null;
        category: string;
      } | null;
      alternatives: { name: string; foldedInto: string | null }[];
      /** Smart lists (chain rules) whose brand this stop's venue matched. `name`: only the brand string agreed. */
      brandMatches?: {
        ruleId: string;
        listId: string;
        listName: string;
        brandName: string;
        strength: "id" | "name";
        auto: boolean;
      }[];
    };
    /** The calendar event that belongs to the stop (spec 2026-11-23, P2); after an answer only its span. */
    calendar?: StayCalendarEvidence;
    /** What the evidence suggests for the visit's purpose; the accept dialog starts with it. */
    suggestedPurpose?: "private" | "business";
    suggestedPurposeFrom?: string;
    /** `calendar` or `plugin:<id>`: what made a finding of a stop with no venue. */
    createdFrom?: string;
    /** The suggestion plugins' answers (spec 2026-11-23, P3), each naming its plugin. */
    plugins?: StayPluginEvidence[];
    /** Plugins that have not answered yet; the scan asks them again. */
    pluginsPending?: string[];
  };
}
export interface StayPluginEvidence {
  pluginId: string;
  pluginName: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  purpose?: "private" | "business";
  note?: string;
  externalRef?: string;
  url?: string;
  confidence: number;
  distanceM?: number | null;
  receivedAt?: string;
  /** The plugin's reason: `name` = matched by a distinctive word, further away. */
  reason?: "distance" | "name";
  matchedToken?: string;
}
export interface StayCalendarEvidence {
  sourceId: string;
  uidHash: string;
  start: string;
  end: string;
  sourceLabel?: string;
  title?: string;
  allDay?: boolean;
  location?: string | null;
  match?: "geocoded" | "placeName" | "rulePlace" | "context";
  timeMatch?: "overlap" | "startNear";
  overlapMinutes?: number;
  geocoded?: { lat: number; lon: number; distanceM: number };
  rule?: { id: string; kind: "calendar" | "keyword"; purpose: "private" | "business" | null };
  proposedName?: string;
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
  purpose?: "private" | "business" | null;
  pluginRef?: { pluginId: string; externalRef: string };
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
  /** The building/venue this candidate sits inside; it stays listed as an alternative. */
  foldedInto?: string | null;
  /** True for the building outline the stay point lies in. */
  isArea?: boolean;
}
export type StayVenueState =
  "ok" | "partial" | "off" | "timeout" | "rateLimited" | "budget" | "unavailable";
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
  /** Whether OSM building outlines took part in the ranking; absent on older servers. */
  venues?: { state: StayVenueState; resolved: "contains" | "folded" | null };
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
  scan: async (
    lookbackDays = 7,
    options: { onPoll?: (job: JobView) => void } = {}
  ): Promise<void> => {
    const { data } = await api.post(`${base}/scan`, { lookbackDays });
    await waitForJob(data.data.jobId, options);
  },
  list: async (status: string): Promise<DawarichStay[]> =>
    (await api.get(base, { params: { status } })).data.data,
  /** Same list plus `meta.truncated`: the server cuts it at 200 rows. */
  listPage: async (status: string): Promise<{ rows: DawarichStay[]; truncated: boolean }> => {
    const body = (await api.get(base, { params: { status } })).data;
    return { rows: body.data, truncated: body.meta?.truncated === true };
  },
  choices: async (): Promise<StayChoices> => (await api.get(`${base}/choices`)).data.data,
  accept: async (id: string, input: StayReviewInput): Promise<void> => {
    await api.post(`${base}/${id}/accept`, input);
  },
  identity: async (id: string): Promise<StayIdentity> =>
    (await api.get(`${base}/${id}/identity`, { timeout: API_TIMEOUTS.STAY_IDENTITY })).data.data,
  placeType: async (id: string): Promise<StayPlaceTypeResult> =>
    (await api.get(`${base}/${id}/place-type`, { timeout: API_TIMEOUTS.STAY_PLACE_TYPE })).data
      .data,
  /** Take a `covered` back (forgejo#439): pending again, never auto-closed again. */
  reopen: async (id: string): Promise<void> => {
    await api.post(`${base}/${id}/reopen`, {});
  },
  reject: async (id: string): Promise<void> => {
    await api.post(`${base}/${id}/reject`, {});
  },
  /** Whether "KI fragen" may show (forgejo#439 phase 2). */
  aiHelpAvailability: async (): Promise<{ available: boolean; reason: string | null }> =>
    (await api.get(`${base}/ai-help/availability`)).data.data,
  /** Advice only; a first use answers 409 CONFIRMATION_REQUIRED (`withUseConsent`). */
  aiHelp: async (id: string, confirmation?: UseConfirmation): Promise<StayAiHelpResult> =>
    (
      await api.post(`${base}/${id}/ai-help`, confirmation ? { confirmation } : {}, {
        timeout: API_TIMEOUTS.STAY_AI_HELP,
      })
    ).data.data,
};

/** `POST /dawarich-stays/:id/ai-help`: a ranked choice with reasons, and who answered. */
export interface StayAiHelpResult {
  answer: { ranking: Array<{ name: string; reason: string }> };
  provider: { kind: string; model: string; host: string; location: "cloud" | "lan" };
}

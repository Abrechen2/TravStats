import { API_URL, api } from "./client";
import { waitForJob } from "./jobs";
import type { PhotoJourney, PhotoJourneyStatus } from "../../types/photoJourney";

/**
 * The photo-journey inbox (`/api/v1/photo-journeys`).
 *
 * An enveloped router (`{success, data}`), per `docs/adr/0001-api-response-shape.md`
 * — every call here unwraps `data`, and none of them invents the bare shape its
 * siblings in `flights.ts` speak.
 *
 * `accept` and `dismiss` are one endpoint (`PATCH /:id`) and two answers. The
 * server records the answer and links what the CLIENT created; it creates
 * nothing itself, deliberately ("no route here creates travel — accepting one
 * is a separate, deliberate act through the normal trip endpoints"). So
 * whatever a caller passes in `PhotoJourneyAcceptLinks` must exist already, and
 * must belong to the caller: the route 404s on an id it cannot find among the
 * user's own rows.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * What a scan did. `scanned: false` is a RESULT, not a failure — an account
 * without Immich is a normal account, and the server answers 200 for it so a
 * client does not paint an error for a feature nobody connected.
 */
export interface PhotoJourneyScanResult {
  scanned: boolean;
  reason?: "immich-not-configured";
  /** Present when `scanned` — how much of the library the scan read. */
  photosSeen?: number;
  /** Immich had more than the page cap allowed. */
  truncated?: boolean;
  created?: number;
  updated?: number;
}

/**
 * What the client created before answering "yes". All optional: the row may be
 * acknowledged without anything being created, which is the honest answer when
 * the finding names something the web cannot build unambiguously.
 */
export interface PhotoJourneyAcceptLinks {
  createdTripId?: string;
  createdPlaceVisitId?: string;
  createdLodgingStayId?: string;
  /**
   * `visit` findings only (forgejo#211): the server creates the place and the
   * visit itself, and these override what the scan called the spot. `name` is
   * required by the server when the scan named nothing (`VISIT_NAME_REQUIRED`).
   */
  name?: string;
  localName?: string;
}

/**
 * The URL of one thumbnail of a row's preview strip.
 *
 * Built from the row id and the INDEX — never from an asset id, which is the
 * whole security property of the proxy: the row is the grant, so a client that
 * cannot name an id cannot turn one journey into a reader for the library.
 *
 * Prefixed with `API_URL` rather than left bare. A root-relative `/api/...` in
 * an `<img src>` goes to Vite's proxy target, which is read from the SHELL at
 * startup, while axios reads `import.meta.env` — with the variable set in only
 * one of the two, the strip would quietly load from a different backend than
 * the rows did (the trap that cost a session on 2026-07-11). In production
 * `API_URL` is empty and this is the root-relative URL the Immich album proxy
 * already hands out.
 */
/**
 * What accepting with a visit did with the finding's photographs: linked them
 * (the server re-finds each id in the caller's own library first), found no
 * library, or found it down. Null when there was nothing to link.
 */
export type PhotoJourneyPhotoOutcome =
  | { kind: "notConfigured" }
  | { kind: "failed"; reason: string }
  | { kind: "linked"; linked: number; skipped: number };

/** Why one item of a batch answer failed (`POST /photo-journeys/batch`). */
export type PhotoJourneyBatchFailureCode =
  | "NOT_FOUND"
  | "ALREADY_ANSWERED"
  | "NOT_A_VISIT"
  | "VISIT_NAME_REQUIRED"
  | "VISIT_PLACE_NOT_FOUND"
  | "TIME_INVALID"
  | "INTERNAL";

/**
 * One item of a batch answer (forgejo#211, O5). Accept is for `visit` findings
 * and carries the reader's corrections; `visitedAt` is the place's wall clock
 * (`{local: "YYYY-MM-DDTHH:mm"}`), never an instant the browser computed.
 */
export interface PhotoJourneyBatchItem {
  id: string;
  action: "accept" | "dismiss";
  name?: string;
  localName?: string;
  placeId?: string;
  visitedAt?: { local: string };
}

export type PhotoJourneyBatchResult =
  | {
      id: string;
      action: "accept";
      outcome: "accepted";
      created: {
        placeId: string;
        placeVisitId: string;
        placeCreated: boolean;
        visitCreated: boolean;
      };
      photos: PhotoJourneyPhotoOutcome | null;
    }
  | { id: string; action: "dismiss"; outcome: "dismissed" }
  | {
      id: string;
      action: "accept" | "dismiss";
      outcome: "failed";
      code: PhotoJourneyBatchFailureCode;
    };

export interface PhotoJourneyBatchResponse {
  results: PhotoJourneyBatchResult[];
  summary: { accepted: number; dismissed: number; failed: number };
}

/** The account's nightly-scan opt-in and what the card says about it (forgejo#94). */
export interface PhotoJourneyNightlySettings {
  nightlyScan: boolean;
  /** The scan's own first question; false for the shared demo account. */
  immichConnected: boolean;
  windowDays: number;
  nextRunAt: string;
  lastRun: {
    ranAt: string;
    result: "scanned" | "noImmich" | "failed";
    created: number | null;
    /** `failed`: an Immich failure kind (`unreachable`, `auth`, …) or `internal`. */
    failure: string | null;
  } | null;
}

export function photoJourneyPreviewUrl(journeyId: string, index: number): string {
  return `${API_URL}/api/v1/photo-journeys/${journeyId}/preview/${index}/file?size=thumbnail`;
}

export const photoJourneysApi = {
  /** `pending` by default, because an inbox is open questions. */
  list: async (status: PhotoJourneyStatus = "pending"): Promise<PhotoJourney[]> => {
    const { data } = await api.get<Envelope<PhotoJourney[]>>("/photo-journeys", {
      params: { status },
    });
    return data.data;
  },

  /**
   * Read the library and look for journeys nothing recorded explains.
   *
   * Expensive and rate-limited on the Immich-import bucket: the default window
   * is ten years and every surviving cluster may cost a reverse lookup, which
   * at Nominatim's 1 req/s makes forty seconds the FLOOR. Never call it on
   * mount — it is a button.
   *
   * Runs as a server job (2026-09-26): held open as one request, the
   * ten-second client timeout announced "scan failed" while the server went
   * on and stored its findings. Throws `JobLostError` when the outcome can no
   * longer be learned — which is not a failure.
   */
  scan: async (): Promise<PhotoJourneyScanResult> => {
    const { data } = await api.post<Envelope<{ jobId: string }>>("/photo-journeys/scan", {
      background: true,
    });
    return waitForJob<PhotoJourneyScanResult>(data.data.jobId);
  },

  accept: async (
    id: string,
    links: PhotoJourneyAcceptLinks = {}
  ): Promise<PhotoJourneyPhotoOutcome | null> => {
    const { data } = await api.patch<Envelope<{ photos: PhotoJourneyPhotoOutcome | null }>>(
      `/photo-journeys/${id}`,
      { status: "accepted", ...links }
    );
    return data.data?.photos ?? null;
  },

  /** The accepted findings that made a trip, and how long each preview strip is. */
  forTrip: async (tripId: string): Promise<Array<{ id: string; previewCount: number }>> => {
    const { data } = await api.get<Envelope<Array<{ id: string; previewCount: number }>>>(
      `/photo-journeys/for-trip/${tripId}`
    );
    return data.data;
  },

  dismiss: async (id: string): Promise<void> => {
    await api.patch(`/photo-journeys/${id}`, { status: "dismissed" });
  },

  /**
   * Answer several findings in one request. The server answers each item on
   * its own and reports every outcome, so a 200 may still carry failures —
   * the caller reads `results`, never just the status.
   */
  review: async (items: PhotoJourneyBatchItem[]): Promise<PhotoJourneyBatchResponse> => {
    const { data } = await api.post<Envelope<PhotoJourneyBatchResponse>>("/photo-journeys/batch", {
      items,
    });
    return data.data;
  },

  getNightlySettings: async (): Promise<PhotoJourneyNightlySettings> => {
    const { data } = await api.get<Envelope<PhotoJourneyNightlySettings>>(
      "/photo-journeys/settings"
    );
    return data.data;
  },

  setNightlyScan: async (nightlyScan: boolean): Promise<PhotoJourneyNightlySettings> => {
    const { data } = await api.put<Envelope<PhotoJourneyNightlySettings>>(
      "/photo-journeys/settings",
      { nightlyScan }
    );
    return data.data;
  },
};

import { API_URL, api } from "./client";
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
   */
  scan: async (): Promise<PhotoJourneyScanResult> => {
    const { data } = await api.post<Envelope<PhotoJourneyScanResult>>("/photo-journeys/scan", {});
    return data.data;
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
};

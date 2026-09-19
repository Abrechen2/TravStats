/**
 * A photo journey as the web reads it — one finding of the photo scan
 * (forgejo#94, point 1: nothing on the web read `/api/v1/photo-journeys`).
 *
 * `GET /api/v1/photo-journeys` answers with Prisma rows untouched (`findMany`
 * with no `select`), so this mirrors `model PhotoJourney` with its `DateTime`
 * columns as ISO strings. Fields the row carries and this inbox never reads —
 * `userId`, `fingerprint`, `updatedAt` — are left out: a client type is a
 * contract for what the client uses, and listing a field nobody reads invites
 * somebody to read it.
 *
 * Every row is a SUGGESTION. A photograph proves where a camera was, which is
 * usually but not always where its owner was, so nothing here is travel until
 * a person answers.
 */

export type PhotoJourneyStatus = "pending" | "accepted" | "dismissed";

/**
 * What the burst is taken for — one burst, one reading, ranked by how much it
 * proves (`backend/src/shared/photoScan.ts`, the rule the Companion reads too):
 *
 * - `place` — photos within 2 km of an own place with no visit that day.
 *   Carries `placeId` and `distanceKm`.
 * - `trip` — away from home near an own, already-flown airport. Carries
 *   `airportIata`, `distanceKm` and `spreadKm`.
 * - `stay` — nights away with no dated stay, named by an own place nearby.
 *   Carries `placeId` and `nights`.
 */
export type PhotoJourneyKind = "place" | "trip" | "stay";

export interface PhotoJourney {
  id: string;
  status: PhotoJourneyStatus;
  kind: PhotoJourneyKind;
  /** The cluster's span, first photo to last. */
  startDate: string;
  endDate: string;
  photoCount: number;
  /**
   * How many of those carried a coordinate. A cluster located by two photos
   * out of sixty deserves less trust than one located by all of them, and the
   * row says so rather than hiding it.
   */
  locatedCount: number;
  lat: number;
  lon: number;
  /** Null when the reverse lookup answered nothing — the DATES are the find. */
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
  /**
   * The Immich ids behind the preview strip.
   *
   * Read for its LENGTH and nothing else: each thumbnail is addressed by its
   * INDEX through `GET /photo-journeys/:id/preview/:index/file`, because the
   * row is the grant. A client that put one of these ids in a URL would be
   * claiming a grant it does not have, and the proxy would refuse it.
   */
  previewAssetIds: string[];
  placeId: string | null;
  distanceKm: number | null;
  nights: number | null;
  airportIata: string | null;
  spreadKm: number | null;
  createdTripId: string | null;
  createdPlaceVisitId: string | null;
  createdLodgingStayId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

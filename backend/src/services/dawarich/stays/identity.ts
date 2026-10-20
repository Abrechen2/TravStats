import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { haversineKm } from "../../../shared/geo/haversine";
import logger from "../../../utils/logger";
import { reverseGeocodeDetailed } from "../../geo/nominatim";
import { reversePlacesDetailed } from "../../geo/photon";
import { createImmichClient } from "../../immich/immichClient";
import { getImmichConnection } from "../../immich/immichResolver";
import { ImmichError } from "../../immich/types";
import { PHOTO_RADIUS_KM } from "../../places/visitDateSuggestions";
import { readSuggestionSwitches } from "../../settings/suggestionSwitches";
import {
  STAY_CANDIDATE_LIMIT,
  STAY_CANDIDATE_RADIUS_KM,
  combineStayIdentity,
  type StayIdentityInput,
  type StayIdentityView,
} from "./identityCombine";

/**
 * Which place a Dawarich stay probably was (forgejo#305) — the I/O half.
 *
 * Asked per CARD, when the card comes into view, never for the whole inbox:
 * the inbox can hold 200 stays, and Nominatim allows one request a second for
 * the whole instance. The geocoders are the very services `/geo/reverse` and
 * `/geo/reverse-places` call, so their process-wide throttle and caches apply
 * here too; this module adds a short per-stay cache on top so re-opening the
 * inbox does not ask Immich and both geocoders again.
 *
 * A stay's own coordinates and window are read from the row, never from the
 * request: the caller names a stay, and only their own stay answers.
 */

/** How long a complete answer is reused. Long enough for a review session. */
export const STAY_IDENTITY_TTL_MS = 15 * 60_000;
/** Bounded so a long-running process cannot grow it without end. */
const STAY_IDENTITY_CACHE_MAX = 500;

export interface StayIdentity extends StayIdentityView {
  lat: number;
  lon: number;
  /** Whether a place-type classification may be asked for (`/place-type`). */
  placeTypeAvailable: boolean;
}

interface CacheEntry {
  view: StayIdentityView;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StayIdentityView>>();

/** Test seam. */
export function clearStayIdentityCache(): void {
  cache.clear();
  inFlight.clear();
}

interface StayAnchor {
  id: string;
  lat: number;
  lon: number;
  sourceStartAt: Date;
  sourceEndAt: Date;
}

async function anchorOf(userId: string, stayId: string): Promise<StayAnchor> {
  const row = await prisma.dawarichStay.findFirst({
    where: { id: stayId, userId },
    select: { id: true, lat: true, lon: true, sourceStartAt: true, sourceEndAt: true },
  });
  if (!row) throw new AppError("Finding not found", 404);
  return row;
}

/**
 * The stay's photos: the library's images taken inside the stay's window
 * (instants, ADR 0002 — no zone needed) within the photo radius of the point.
 */
async function photosOf(
  userId: string,
  stay: StayAnchor,
  enabled: boolean
): Promise<StayIdentityInput["photos"]> {
  if (!enabled) return { state: "off", assets: [], truncated: false };
  const connection = await getImmichConnection(userId);
  if (connection === null) return { state: "notConfigured", assets: [], truncated: false };
  try {
    const page = await createImmichClient(connection).searchAssetsByDate({
      takenAfter: stay.sourceStartAt,
      takenBefore: stay.sourceEndAt,
    });
    const near = page.assets.filter(
      (asset) =>
        asset.lat !== null &&
        asset.lon !== null &&
        haversineKm(stay, { lat: asset.lat, lon: asset.lon }) <= PHOTO_RADIUS_KM
    );
    return { state: "ok", assets: near, truncated: page.truncated };
  } catch (error) {
    if (!(error instanceof ImmichError)) throw error;
    logger.warn({ kind: error.kind, stayId: stay.id }, "stay identity: Immich evidence failed");
    return { state: error.kind, assets: [], truncated: false };
  }
}

/** Only an answer with nothing failed in it is worth keeping; a failure retries next time. */
function complete(view: StayIdentityView): boolean {
  return (
    view.geocoder !== "degraded" &&
    view.candidatesState !== "degraded" &&
    (view.photos.state === "ok" ||
      view.photos.state === "off" ||
      view.photos.state === "notConfigured")
  );
}

async function computeView(
  userId: string,
  stay: StayAnchor,
  immichEvidence: boolean
): Promise<StayIdentityView> {
  const [geocode, places, photos] = await Promise.all([
    reverseGeocodeDetailed(stay.lat, stay.lon),
    reversePlacesDetailed(stay.lat, stay.lon, {
      limit: STAY_CANDIDATE_LIMIT,
      radiusKm: STAY_CANDIDATE_RADIUS_KM,
    }),
    photosOf(userId, stay, immichEvidence),
  ]);
  return combineStayIdentity({ point: stay, geocode, places, photos });
}

/** The combined view of one stay, cached per stay, position and Immich switch. */
export async function stayIdentityView(
  userId: string,
  stay: StayAnchor,
  immichEvidence: boolean
): Promise<StayIdentityView> {
  // The position is part of the key: a corrected stay is a different question.
  const key = JSON.stringify([userId, stay.id, stay.lat, stay.lon, immichEvidence]);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.view;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = computeView(userId, stay, immichEvidence)
    .then((view) => {
      if (complete(view)) {
        if (cache.size >= STAY_IDENTITY_CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { view, expiresAt: Date.now() + STAY_IDENTITY_TTL_MS });
      }
      return view;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function stayIdentityFor(userId: string, stayId: string): Promise<StayIdentity> {
  const stay = await anchorOf(userId, stayId);
  const switches = await readSuggestionSwitches(userId);
  const view = await stayIdentityView(userId, stay, switches.staySuggestionsImmichEvidence);
  return {
    lat: stay.lat,
    lon: stay.lon,
    ...view,
    placeTypeAvailable:
      switches.staySuggestionsLlmPlaceClassification && view.candidates.length > 0,
  };
}

export { anchorOf as stayAnchorOf };

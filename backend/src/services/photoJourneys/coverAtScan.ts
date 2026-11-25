import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { loadCoverContext, type CoverContext, type CoverTarget } from "../suggestions/covered";
import type { ScanPhoto } from "./cluster";

/**
 * The photo scans' side of the shared "already recorded" rule (forgejo#439):
 * one read of the entries that could cover anything the library shows, and
 * the target a burst or a stop is judged as.
 */
const EMPTY: CoverContext = { visits: [], lodgingStays: [], flights: [], places: [] };

export async function coverContextForPhotos(
  userId: string,
  photos: readonly ScanPhoto[]
): Promise<CoverContext> {
  // A reduce, not Math.min(...): a library is tens of thousands of photos.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of photos) {
    if (!Number.isFinite(p.takenAtMs)) continue;
    if (p.takenAtMs < lo) lo = p.takenAtMs;
    if (p.takenAtMs > hi) hi = p.takenAtMs;
  }
  if (!Number.isFinite(lo)) return EMPTY;
  return loadCoverContext(userId, new Date(lo), new Date(hi), { flights: true, places: true });
}

export function photoCoverTarget(
  span: { startMs: number; endMs: number },
  at: { lat: number; lon: number },
  tripId: string | null,
  zone: string | null = zoneOfCoordinates(at.lat, at.lon)
): CoverTarget {
  return {
    startAt: new Date(span.startMs),
    endAt: new Date(span.endMs),
    lat: at.lat,
    lon: at.lon,
    zone,
    tripId,
  };
}

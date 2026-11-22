/**
 * Ranking of cover-photo candidates for a trip — pure, no I/O.
 *
 * The score is a sum of named reasons, each with its points, so the client can
 * say WHY a photo was suggested ("you are in it, taken near your hotel, a
 * favourite") instead of showing a bare number. A photo that earns nothing
 * but quality points never qualifies: the threshold sits above the most a
 * quality-only photo can reach, so the answer can be "no suggestion" rather
 * than the least bad photo of the trip (abstention).
 */
import { haversineKm } from "../../shared/geo/haversine";

export type ReasonCode =
  "me" | "placeClose" | "placeNearby" | "favorite" | "highQuality" | "landscape" | "resolution";

export interface Reason {
  code: ReasonCode;
  points: number;
}

export interface CoverAnchor {
  lat: number;
  lon: number;
}

export interface CoverCandidate {
  /** Unique per photo across every path it was found by. */
  key: string;
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
  isVideo: boolean;
  mimeType: string;
  fileName: string;
  /** A person the account marked as "Das bin ich" is in the photo. */
  me: boolean;
  favorite?: boolean;
  width?: number | null;
  height?: number | null;
  cameraMake?: string | null;
  quality?: number | null;
}

export interface ScoredCandidate<T extends CoverCandidate = CoverCandidate> {
  candidate: T;
  score: number;
  reasons: Reason[];
}

export const POINTS = {
  me: 40,
  placeClose: 25,
  placeNearby: 10,
  favorite: 20,
  highQuality: 8,
  landscape: 8,
  resolutionHigh: 6,
  resolutionMid: 3,
} as const;

/** "At the place": the building, the street in front of it, the viewpoint. */
export const PLACE_CLOSE_KM = 2;
/** "In the area": the same town or bay. */
export const PLACE_NEARBY_KM = 15;
/** A photo needs this much to be offered; quality alone tops out at 22. */
export const MIN_SCORE = 30;
export const MAX_SUGGESTIONS = 3;
/** Frames this close together are one burst; the best of them stands. */
export const BURST_SECONDS = 5;
const LANDSCAPE_RATIO = 1.2;
const MEGAPIXEL = 1_000_000;
const PHOTOPRISM_QUALITY_HIGH = 5;
const DOCUMENT_NAME = /screenshot|screen[ _-]?shot|bildschirmfoto|scan|document|dokument|receipt/i;

/** A screenshot, a scan or a document is never a travel cover. */
export function looksLikeNonPhoto(c: CoverCandidate): boolean {
  if (c.isVideo) return true;
  if (!c.mimeType.toLowerCase().startsWith("image/")) return true;
  if (DOCUMENT_NAME.test(c.fileName)) return true;
  // A camera writes JPEG/HEIC; a PNG with no camera make is a screen capture.
  return c.mimeType.toLowerCase() === "image/png" && !c.cameraMake;
}

function nearestKm(c: CoverCandidate, anchors: readonly CoverAnchor[]): number | null {
  if (c.lat === null || c.lon === null || anchors.length === 0) return null;
  let best = Infinity;
  for (const a of anchors) {
    best = Math.min(best, haversineKm({ lat: c.lat, lon: c.lon }, a));
  }
  return Number.isFinite(best) ? best : null;
}

export function scoreCandidate<T extends CoverCandidate>(
  c: T,
  anchors: readonly CoverAnchor[]
): ScoredCandidate<T> {
  const reasons: Reason[] = [];
  if (c.me) reasons.push({ code: "me", points: POINTS.me });

  const km = nearestKm(c, anchors);
  if (km !== null && km <= PLACE_CLOSE_KM) {
    reasons.push({ code: "placeClose", points: POINTS.placeClose });
  } else if (km !== null && km <= PLACE_NEARBY_KM) {
    reasons.push({ code: "placeNearby", points: POINTS.placeNearby });
  }

  if (c.favorite === true) reasons.push({ code: "favorite", points: POINTS.favorite });
  if (typeof c.quality === "number" && c.quality >= PHOTOPRISM_QUALITY_HIGH) {
    reasons.push({ code: "highQuality", points: POINTS.highQuality });
  }

  // Unknown dimensions earn nothing and cost nothing: a local upload has none.
  const w = c.width ?? null;
  const h = c.height ?? null;
  if (w !== null && h !== null && w > 0 && h > 0) {
    if (w / h >= LANDSCAPE_RATIO) reasons.push({ code: "landscape", points: POINTS.landscape });
    const pixels = w * h;
    if (pixels >= 8 * MEGAPIXEL) {
      reasons.push({ code: "resolution", points: POINTS.resolutionHigh });
    } else if (pixels >= 2 * MEGAPIXEL) {
      reasons.push({ code: "resolution", points: POINTS.resolutionMid });
    }
  }

  return { candidate: c, score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

const byRank = (a: ScoredCandidate, b: ScoredCandidate): number =>
  b.score - a.score ||
  (a.candidate.takenAt?.getTime() ?? 0) - (b.candidate.takenAt?.getTime() ?? 0) ||
  a.candidate.key.localeCompare(b.candidate.key);

/**
 * The best qualifying photos, best first, at most `MAX_SUGGESTIONS`. Empty
 * means "nothing qualified" — the caller says so instead of faking one.
 */
export function rankCoverCandidates<T extends CoverCandidate>(
  candidates: readonly T[],
  anchors: readonly CoverAnchor[]
): ScoredCandidate<T>[] {
  const qualifying = candidates
    .filter((c) => !looksLikeNonPhoto(c))
    .map((c) => scoreCandidate(c, anchors))
    .filter((s) => s.score >= MIN_SCORE)
    .sort(byRank);

  // Burst dedupe: walk best first, drop a frame within seconds of one kept.
  const kept: ScoredCandidate<T>[] = [];
  for (const s of qualifying) {
    const at = s.candidate.takenAt?.getTime() ?? null;
    const inBurst =
      at !== null &&
      kept.some((k) => {
        const other = k.candidate.takenAt?.getTime();
        return other !== undefined && Math.abs(other - at) <= BURST_SECONDS * 1000;
      });
    if (!inBurst) kept.push(s);
    if (kept.length === MAX_SUGGESTIONS) break;
  }
  return kept;
}

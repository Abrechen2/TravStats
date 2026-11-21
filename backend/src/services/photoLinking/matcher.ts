import { haversineKm } from "../../shared/geo/haversine";
import logger from "../../utils/logger";
import { ImmichError, type ImmichErrorKind } from "../immich/types";
import { createPhotoSource, type PhotoSourceKind, PHOTO_SOURCE_KINDS } from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import type { PhotoSourceAsset } from "../photoSource/types";
import type { ZoneCircle } from "../travtrack/classify";

/**
 * The one matcher every automatic photo link goes through (owner, 2026-11-21:
 * "bei Ortseinträgen … oder bei Flügen usw."). An entry describes WHEN it
 * happened (a window of instants) and WHERE (points with a radius, or a
 * corridor between two points); the matcher answers which photos of the
 * user's photo sources belong to it. The rules live here and nowhere else:
 *
 * - a photo with no trustworthy capture time or no position never matches
 *   (abstention: an undated photo is not "from today");
 * - a photo inside a TravTrack privacy zone never matches, however it fits;
 * - a refused photo (per entry and source) never comes back;
 * - the result is the earliest `cap` matches, so one busy day cannot link
 *   hundreds of pictures.
 *
 * Entries with different shapes (a flight, a stay, a cruise stop) differ only
 * in the {@link MatchSpec} they build; `linkTargets.ts` is the registry that
 * says which entry types have a surface to show linked photos on.
 */

export type LinkLocation =
  | { kind: "point"; lat: number; lon: number; radiusKm: number }
  | {
      kind: "corridor";
      from: { lat: number; lon: number };
      to: { lat: number; lon: number };
      radiusKm: number;
    };

export interface MatchSpec {
  /** Inclusive instants. */
  window: { start: Date; end: Date };
  /** A photo matching ANY location matches. */
  locations: readonly LinkLocation[];
  /** Privacy zones in force for the window; a photo inside one is dropped. */
  circles: readonly ZoneCircle[];
  /** `provider:assetId` keys the user refused for this entry. */
  refused: ReadonlySet<string>;
  cap: number;
}

export interface SourcedAsset {
  provider: PhotoSourceKind;
  asset: PhotoSourceAsset;
}

export const refusalKey = (provider: PhotoSourceKind, assetId: string): string =>
  `${provider}:${assetId}`;

type LatLon = { lat: number; lon: number };

/** Distance from `p` to the segment `a`–`b`, in km (local flat approximation). */
function distanceToSegmentKm(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * k;
  const ay = a.lat - p.lat;
  const dx = (b.lon - a.lon) * k;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const s = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
  const nearest = { lat: a.lat + s * (b.lat - a.lat), lon: a.lon + s * (b.lon - a.lon) };
  return haversineKm(p, nearest);
}

function withinLocation(p: LatLon, loc: LinkLocation): boolean {
  return loc.kind === "point"
    ? haversineKm(p, loc) <= loc.radiusKm
    : distanceToSegmentKm(p, loc.from, loc.to) <= loc.radiusKm;
}

/** Why a photo is (not) a match; exported for the abstention tests. */
export function matches(asset: PhotoSourceAsset, spec: MatchSpec): boolean {
  if (asset.type !== "IMAGE") return false;
  if (asset.fileCreatedAt === null || asset.lat === null || asset.lon === null) return false;
  const at = Date.parse(asset.fileCreatedAt);
  if (!Number.isFinite(at)) return false;
  if (at < spec.window.start.getTime() || at > spec.window.end.getTime()) return false;
  const p = { lat: asset.lat, lon: asset.lon };
  if (spec.circles.some((c) => haversineKm(p, c) * 1000 <= c.radiusM)) return false;
  return spec.locations.some((loc) => withinLocation(p, loc));
}

export function matchAssets(candidates: readonly SourcedAsset[], spec: MatchSpec): SourcedAsset[] {
  return candidates
    .filter((c) => !spec.refused.has(refusalKey(c.provider, c.asset.id)) && matches(c.asset, spec))
    .sort(
      (x, y) =>
        Date.parse(x.asset.fileCreatedAt!) - Date.parse(y.asset.fileCreatedAt!) ||
        x.asset.id.localeCompare(y.asset.id)
    )
    .slice(0, spec.cap);
}

/**
 * `truncated`: the source answered but had more photos in the window than one
 * search reads, so the matches below are a prefix — a visible reason, never a
 * silent miss.
 */
export type SourceState = "ok" | "notConfigured" | "truncated" | ImmichErrorKind;

export interface WindowAssets {
  /** What each source answered; a failing source never hides the other. */
  sources: Record<PhotoSourceKind, SourceState>;
  candidates: SourcedAsset[];
}

/** A search window is read through this; tests and the suggestion cache wrap it. */
export type WindowSearch = (
  provider: PhotoSourceKind,
  window: { start: Date; end: Date }
) => Promise<PhotoSourceAsset[] & { truncated?: boolean }>;

export function directSearch(userId: string): WindowSearch {
  return async (provider, window) => {
    const connection = await getPhotoSourceConnection(provider, userId);
    if (connection === null) throw new NotConfigured();
    const page = await createPhotoSource(provider, connection).searchAssetsByTime({
      takenAfter: window.start,
      takenBefore: window.end,
    });
    // The flag rides on the array, like `AlbumAssetList`.
    return Object.assign([...page.assets], { truncated: page.truncated });
  };
}

export class NotConfigured extends Error {}

/**
 * Ask every photo source for the window. One source failing is recorded in
 * `sources` with its failure kind and the others are still read: the answer is
 * never a silent "no photos" (defect class 3).
 */
export async function candidatesForWindow(
  search: WindowSearch,
  window: { start: Date; end: Date },
  providers: readonly PhotoSourceKind[] = PHOTO_SOURCE_KINDS
): Promise<WindowAssets> {
  const sources = {} as Record<PhotoSourceKind, SourceState>;
  const candidates: SourcedAsset[] = [];
  await Promise.all(
    providers.map(async (provider) => {
      try {
        const assets = await search(provider, window);
        sources[provider] = assets.truncated ? "truncated" : "ok";
        candidates.push(...assets.map((asset) => ({ provider, asset })));
      } catch (error) {
        if (error instanceof NotConfigured) {
          sources[provider] = "notConfigured";
        } else if (error instanceof ImmichError) {
          sources[provider] = error.kind;
        } else {
          logger.error({ message: "photo_link_source_failed", context: { provider }, error });
          sources[provider] = "protocol";
        }
      }
    })
  );
  return { sources, candidates };
}

/** The one state a client that knows a single `library` field reads. */
export function aggregateState(sources: Record<string, SourceState>): SourceState {
  const states = Object.values(sources);
  if (states.includes("ok") || states.includes("truncated")) return "ok";
  const failure = states.find((s) => s !== "notConfigured");
  return failure ?? "notConfigured";
}

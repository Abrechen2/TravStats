import { haversineKm } from "../../shared/geo/haversine";
import { ImmichError } from "../immich/types";
import { createPhotoSource, listAllAlbumAssets, type PhotoSourceKind } from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import { privacyCircleSet } from "../travtrack/privacyCircles";
import type { EntryPlan } from "./entryKinds";
import type { Found } from "./entryPhotos";
import { distanceKmTo, type SourcedAsset, type SourceState } from "./matcher";

/**
 * "Aus Album wählen" (owner, 2026-11-22): the candidates of an entry are the photos of ONE album
 * or folder of a connected source, instead of what the matcher finds by time and place. The album
 * is never linked — it only narrows what the user chooses from, and the user still keeps 5–10
 * photos. Albums belong to the trip gallery.
 *
 * By default only the album's photos taken inside the entry's window count; `anyDate` lifts the
 * window. Either way a photo with no trustworthy capture time is left out (abstention: an
 * undated photo is not "from this stay") and a photo inside a privacy zone never shows.
 */
export interface AlbumPick {
  provider: PhotoSourceKind;
  albumId: string;
  anyDate: boolean;
}

export async function albumMatches(
  userId: string,
  plan: Exclude<EntryPlan, "untimed">,
  album: AlbumPick
): Promise<Found> {
  const windows = plan.legs.map((l) => l.window);
  const found: Found = { matched: [], sources: {}, windows };
  const connection = await getPhotoSourceConnection(album.provider, userId);
  if (connection === null) {
    found.sources[album.provider] = "notConfigured";
    return found;
  }
  let assets;
  try {
    assets = await listAllAlbumAssets(createPhotoSource(album.provider, connection), album.albumId);
  } catch (error) {
    // The kind vocabulary reaches the user as itself; anything else is a server fault.
    if (!(error instanceof ImmichError)) throw error;
    found.sources[album.provider] = error.kind;
    return found;
  }
  const state: SourceState = assets.truncated ? "truncated" : "ok";
  found.sources[album.provider] = state;
  const zones = await privacyCircleSet(userId);
  const locations = plan.legs.flatMap((l) => l.locations);
  const inWindow = (at: number): boolean =>
    windows.some((w) => at >= w.start.getTime() && at <= w.end.getTime());
  const matched: SourcedAsset[] = [];
  for (const asset of assets) {
    if (asset.type !== "IMAGE" || asset.fileCreatedAt === null) continue;
    const at = Date.parse(asset.fileCreatedAt);
    if (!Number.isFinite(at)) continue;
    if (!album.anyDate && !inWindow(at)) continue;
    if (
      asset.lat !== null &&
      asset.lon !== null &&
      zones(at).some(
        (c) => haversineKm({ lat: asset.lat!, lon: asset.lon! }, c) * 1000 <= c.radiusM
      )
    ) {
      continue;
    }
    matched.push({
      provider: album.provider,
      asset,
      distanceKm: distanceKmTo(asset, locations) ?? undefined,
    });
  }
  found.matched = matched.sort(
    (a, b) =>
      Date.parse(a.asset.fileCreatedAt!) - Date.parse(b.asset.fileCreatedAt!) ||
      a.asset.id.localeCompare(b.asset.id)
  );
  return found;
}

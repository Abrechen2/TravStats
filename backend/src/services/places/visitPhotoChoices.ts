import { prisma } from "../../db";
import { photoCapFor } from "../photoLinking/cap";
import { ENTRY_CHOICE_LIMIT } from "../photoLinking/entryPhotos";
import {
  capMatches,
  matchAssets,
  refusalKey,
  type MatchSpec,
  type SourcedAsset,
  type SourceState,
} from "../photoLinking/matcher";
import type { PhotoSourceKind } from "../photoSource";
import { toPhotoSourceKind } from "../photoSource/connection";
import { openInLinks, type OpenInLink } from "../photoSource/deepLink";
import { privacyCircleSet } from "../travtrack/privacyCircles";
import { takenAtLocal } from "../photoLinking/choiceTarget";
import { PHOTO_RADIUS_KM } from "./visitDateSuggestions";
import { anchorOf, dayWindow, libraryAssetsNear } from "./visitPhotoSuggestions";
import { linkAssetsToVisit } from "./visitPhotoLinks";

/**
 * "Fotos auswählen" for a place visit — the visit twin of
 * `photoLinking/entryChoices.ts`; the rules (a tick is the user's own pick, a
 * swap drops the automatic link without a refusal, an unreplaced untick is
 * remembered as a refusal) are the same and documented there.
 */

export interface VisitChoice {
  id: string;
  provider: PhotoSourceKind;
  assetId: string;
  url: string;
  takenAt: string | null;
  /** Wall clock at the place (`YYYY-MM-DDTHH:mm:ss`); null when no zone is known, never UTC. */
  takenAtLocal: string | null;
  distanceM: number | null;
  chosen: boolean;
  provenance: "manual" | "auto" | null;
  refused: boolean;
}

export interface VisitChoices {
  choices: VisitChoice[];
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
  cap: number;
  openIn: OpenInLink[];
}

export interface VisitChoiceChange {
  select: { provider: PhotoSourceKind; assetId: string }[];
  deselect: { provider: PhotoSourceKind; assetId: string }[];
}

const urlOf = (visitId: string, provider: PhotoSourceKind, assetId: string): string => {
  const base = `/api/v1/places/visits/${visitId}/photo-suggestions/library/${assetId}/file`;
  return provider === "immich" ? base : `${base}?provider=${provider}`;
};

/** The visit's day and place; null when it is not the caller's, `undated` when it has no day. */
async function candidates(userId: string, visitId: string) {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null || anchor === "undated") return anchor;
  const window = dayWindow(anchor);
  const [library, circles, refusals, rows] = await Promise.all([
    libraryAssetsNear(userId, anchor),
    privacyCircleSet(userId).then((at) => at(window.start.getTime())),
    prisma.visitPhotoRefusal.findMany({
      where: { placeVisitId: visitId, kind: "library" },
      select: { provider: true, suggestionId: true },
    }),
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId, immichAssetId: { not: null } },
    }),
  ]);
  const spec: MatchSpec = {
    window,
    locations: [{ kind: "point", lat: anchor.lat, lon: anchor.lon, radiusKm: PHOTO_RADIUS_KM }],
    circles,
    refused: new Set(),
  };
  const matched = matchAssets(library.assets, spec);
  const refused = new Set(
    refusals.map((r) => refusalKey(toPhotoSourceKind(r.provider), r.suggestionId))
  );
  const rowOf = new Map(
    rows.map((r) => [refusalKey(toPhotoSourceKind(r.provider), r.immichAssetId!), r])
  );
  return { anchor, window, library, matched, refused, rowOf };
}

/**
 * Km to the place per `provider:assetId` for a visit's day, read off the
 * matcher's candidates (the trim pass ranks stored links with it). Null when a
 * photo source failed to answer — the caller must not trim on a guess.
 */
export async function visitCandidateDistances(
  userId: string,
  visitId: string
): Promise<Map<string, number> | null> {
  const found = await candidates(userId, visitId);
  if (found === null || found === "undated") return new Map();
  if (
    Object.values(found.library.sources).some(
      (s) => s !== "ok" && s !== "notConfigured" && s !== "truncated"
    )
  ) {
    return null;
  }
  return new Map(
    found.matched.flatMap((m) =>
      m.distanceKm === undefined
        ? []
        : [[refusalKey(m.provider, m.asset.id), m.distanceKm] as const]
    )
  );
}

export async function visitChoicesFor(
  userId: string,
  visitId: string
): Promise<VisitChoices | null> {
  const found = await candidates(userId, visitId);
  if (found === null) return null;
  const cap = await photoCapFor(userId);
  if (found === "undated") return { choices: [], sources: {}, cap, openIn: [] };
  const { anchor, window, library, matched, refused, rowOf } = found;
  const key = (m: SourcedAsset) => refusalKey(m.provider, m.asset.id);
  const chosen = matched.filter((m) => rowOf.has(key(m)));
  const rest = matched.filter((m) => !rowOf.has(key(m)));
  const room = Math.max(0, ENTRY_CHOICE_LIMIT - chosen.length);
  const others = rest.length <= room ? rest : capMatches(rest, room);
  const listed = [...chosen, ...others];
  const choices: VisitChoice[] = listed.map((m) => {
    const row = rowOf.get(key(m));
    return {
      id: `${m.provider}:${m.asset.id}`,
      provider: m.provider,
      assetId: m.asset.id,
      url: urlOf(visitId, m.provider, m.asset.id),
      takenAt: m.asset.fileCreatedAt,
      takenAtLocal: takenAtLocal(m.asset.fileCreatedAt, null, anchor.tz),
      distanceM: m.distanceKm === undefined ? null : Math.round(m.distanceKm * 1000),
      chosen: row !== undefined,
      provenance: row ? (row.provenance === "auto" ? "auto" : "manual") : null,
      refused: row === undefined && refused.has(key(m)),
    };
  });
  choices.sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? ""));
  const providers = (Object.keys(library.sources) as PhotoSourceKind[]).filter(
    (p) => library.sources[p] !== "notConfigured"
  );
  return {
    choices,
    sources: library.sources,
    cap,
    openIn: await openInLinks(userId, providers, {
      window,
      point: { lat: anchor.lat, lon: anchor.lon, radiusKm: PHOTO_RADIUS_KM },
    }),
  };
}

export async function saveVisitChoice(
  userId: string,
  visitId: string,
  change: VisitChoiceChange
): Promise<{ picked: number; swapped: number; refused: number; skipped: number } | null> {
  const found = await candidates(userId, visitId);
  if (found === null) return null;
  if (found === "undated")
    return { picked: 0, swapped: 0, refused: 0, skipped: change.select.length };
  const { matched, rowOf } = found;
  const byKey = new Map(matched.map((m) => [refusalKey(m.provider, m.asset.id), m]));

  let picked = 0;
  let skipped = 0;
  const toLink: SourcedAsset[] = [];
  const promote: string[] = [];
  for (const pick of change.select) {
    const key = refusalKey(pick.provider, pick.assetId);
    const row = rowOf.get(key);
    if (row) {
      if (row.provenance !== "manual") {
        promote.push(row.id);
        picked += 1;
      }
      continue;
    }
    const m = byKey.get(key);
    if (m) toLink.push(m);
    else skipped += 1;
  }
  if (promote.length > 0) {
    await prisma.placeVisitPhoto.updateMany({
      where: { id: { in: promote } },
      data: { provenance: "manual" },
    });
  }
  picked += await linkAssetsToVisit(visitId, toLink, "manual");
  // A pick overrides an earlier "Nicht diese".
  if (toLink.length > 0) {
    await prisma.visitPhotoRefusal.deleteMany({
      where: {
        placeVisitId: visitId,
        kind: "library",
        OR: toLink.map((m) => ({ provider: m.provider, suggestionId: m.asset.id })),
      },
    });
  }

  let swapSlots = picked;
  let swapped = 0;
  const refuse: { provider: PhotoSourceKind; assetId: string }[] = [];
  const removeIds: string[] = [];
  for (const drop of change.deselect) {
    const row = rowOf.get(refusalKey(drop.provider, drop.assetId));
    // Only links; a stored copy of a photo is deleted from the photo list, not here.
    if (!row || row.filename !== null) continue;
    removeIds.push(row.id);
    if (row.provenance === "auto" && swapSlots > 0) {
      swapSlots -= 1;
      swapped += 1;
    } else {
      refuse.push(drop);
    }
  }
  if (removeIds.length > 0) {
    await prisma.$transaction([
      prisma.visitPhotoRefusal.createMany({
        data: refuse.map((r) => ({
          userId,
          placeVisitId: visitId,
          kind: "library",
          provider: r.provider,
          suggestionId: r.assetId,
        })),
        skipDuplicates: true,
      }),
      prisma.placeVisitPhoto.deleteMany({ where: { id: { in: removeIds } } }),
    ]);
  }
  return { picked, swapped, refused: refuse.length, skipped };
}

import { prisma } from "../../db";
import { photoCapFor } from "./cap";
import type { PhotoSourceKind } from "../photoSource";
import { openInLinks, type OpenInLink } from "../photoSource/deepLink";
import type { EntryKind } from "./entryKinds";
import { planFor } from "./entryKinds";
import {
  cacheKey,
  ENTRY_CHOICE_LIMIT,
  findMatches,
  fkOf,
  suggestionCache,
  toKind,
  writeLinks,
  type EntrySuggestions,
  type PickedAsset,
} from "./entryPhotos";
import {
  capMatches,
  directSearch,
  refusalKey,
  type SourcedAsset,
  type SourceState,
  type WindowSearch,
} from "./matcher";
import { albumMatches, type AlbumPick } from "./albumCandidates";
import { choiceTarget, planZone, takenAtLocal, windowDays } from "./choiceTarget";
import { repairAutoCovers } from "../coverSuggestions/autoCover";

/** "Alle laden": what the choose view lists at most when the user asks for everything. */
export const ENTRY_CHOICE_ALL_LIMIT = 500;

export interface ChoiceOptions {
  /** List every candidate (up to {@link ENTRY_CHOICE_ALL_LIMIT}), not the spread of {@link ENTRY_CHOICE_LIMIT}. */
  all?: boolean;
  /** Candidates are one album's photos instead of the matcher's. */
  album?: AlbumPick;
}

/**
 * "Fotos auswählen" for an entry (owner, 2026-11-21): every candidate the
 * matcher finds, with the linked ones ticked. A tick makes the photo the user's
 * own pick (provenance `manual`), which no re-run ever removes. Swapping an
 * automatic link for another photo drops the automatic one WITHOUT a refusal;
 * unticking with nothing to replace it is an explicit removal and is remembered
 * as a refusal, or the next pass would put the photo back.
 */

export interface EntryChoice {
  url: string;
  provider: PhotoSourceKind;
  assetId: string;
  takenAt: string | null;
  /** Wall clock where it was taken (`YYYY-MM-DDTHH:mm:ss`); null when no zone is known, never UTC. */
  takenAtLocal: string | null;
  mimetype: string;
  /** Null when the source gave no position for a linked photo that no longer matches. */
  distanceM: number | null;
  chosen: boolean;
  provenance: "manual" | "auto" | null;
  /** The user removed it earlier; shown unticked, a tick brings it back. */
  refused: boolean;
}

export interface EntryChoices {
  choices: EntryChoice[];
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
  untimed: boolean;
  /** Automatic links per entry, the account's setting. */
  cap: number;
  openIn: OpenInLink[];
  /** The local days searched (what the time window says on screen). */
  window?: { from: string; to: string };
  /** Candidates found in all, before the list was thinned; `choices` may hold fewer. */
  total?: number;
  /** True when `choices` is a spread of `total`, so the view offers "alle laden". */
  thinned?: boolean;
  /** The album the candidates came from, when the user picked one. */
  album?: { provider: PhotoSourceKind; albumId: string; anyDate: boolean };
}

export async function entryChoicesFor(
  userId: string,
  kind: EntryKind,
  id: string,
  search: WindowSearch = directSearch(userId),
  options: ChoiceOptions = {}
): Promise<EntryChoices | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null) return null;
  const cap = await photoCapFor(userId);
  if (plan === "untimed") return { choices: [], sources: {}, untimed: true, cap, openIn: [] };

  const [found, rows] = await Promise.all([
    options.album
      ? albumMatches(userId, plan, options.album)
      : findMatches(userId, kind, id, plan, search, "none"),
    prisma.entryPhotoLink.findMany({ where: { userId, ...fkOf(kind, id) } }),
  ]);
  const rowOf = new Map(rows.map((r) => [refusalKey(toKind(r.provider), r.assetId), r]));
  const isChosen = (m: SourcedAsset) => {
    const row = rowOf.get(refusalKey(m.provider, m.asset.id));
    return row !== undefined && !row.refused;
  };
  // Everything chosen is listed; the room left is spread over the rest, so a
  // camera roll of a long stay shows a spread, not its first hour.
  const chosen = found.matched.filter(isChosen);
  const rest = found.matched.filter((m) => !isChosen(m));
  const room = Math.max(
    0,
    (options.all ? ENTRY_CHOICE_ALL_LIMIT : ENTRY_CHOICE_LIMIT) - chosen.length
  );
  // Below the limit every candidate is listed — a burst's frames included, so the
  // user can pick the one they like; the spread only thins an overlong list.
  const others = rest.length <= room ? rest : capMatches(rest, room);
  const listed = [...chosen, ...others];
  const zone = planZone(plan);
  const listedKeys = new Set(listed.map((m) => refusalKey(m.provider, m.asset.id)));
  const choices: EntryChoice[] = listed.map((m) => {
    const row = rowOf.get(refusalKey(m.provider, m.asset.id));
    return {
      url: `/api/v1/entry-photos/${kind}/${id}/photo-suggestions/${m.provider}/${m.asset.id}/file`,
      provider: m.provider,
      assetId: m.asset.id,
      takenAt: m.asset.fileCreatedAt,
      takenAtLocal: takenAtLocal(m.asset.fileCreatedAt, m.asset, zone),
      mimetype: m.asset.mimeType,
      distanceM: m.distanceKm === undefined ? null : Math.round(m.distanceKm * 1000),
      chosen: row !== undefined && !row.refused,
      provenance: row && !row.refused ? (row.provenance === "auto" ? "auto" : "manual") : null,
      refused: row?.refused ?? false,
    };
  });
  // A link that no longer matches (the source is down, the entry moved) still shows.
  for (const row of rows) {
    const provider = toKind(row.provider);
    if (row.refused || listedKeys.has(refusalKey(provider, row.assetId))) continue;
    choices.push({
      url: `/api/v1/entry-photos/${kind}/${id}/photos/${row.id}/file`,
      provider,
      assetId: row.assetId,
      takenAt: row.takenAt?.toISOString() ?? null,
      takenAtLocal: takenAtLocal(row.takenAt?.toISOString() ?? null, null, zone),
      mimetype: row.mimetype,
      distanceM: null,
      chosen: true,
      provenance: row.provenance === "auto" ? "auto" : "manual",
      refused: false,
    });
  }
  choices.sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? ""));

  // The thumbnail route serves an id only after the server found it itself.
  const value: EntrySuggestions = {
    untimed: false,
    sources: found.sources,
    suggestions: listed.map(({ provider, asset }) => ({
      url: "",
      provider,
      assetId: asset.id,
      takenAt: asset.fileCreatedAt,
      mimetype: asset.mimeType,
    })),
  };
  suggestionCache.set(`${cacheKey(userId, kind, id)}:choices`, { at: Date.now(), value });

  const providers = (Object.keys(found.sources) as PhotoSourceKind[]).filter(
    (p) => found.sources[p] !== "notConfigured"
  );
  return {
    choices,
    sources: found.sources,
    untimed: false,
    cap,
    openIn: await openInLinks(userId, providers, choiceTarget(plan)),
    window: windowDays(plan),
    total: found.matched.length,
    thinned: others.length < rest.length,
    ...(options.album ? { album: options.album } : {}),
  };
}

export interface ChoiceSaveResult {
  /** Photos now held as the user's own pick (new or promoted from automatic). */
  picked: number;
  /** Automatic links dropped because a pick replaced them; nothing recorded. */
  swapped: number;
  /** Links removed with nothing to replace them; remembered so no pass re-links them. */
  refused: number;
  /** Picks the server could not prove to be a candidate of this entry. */
  skipped: number;
}

export async function saveEntryChoice(
  userId: string,
  kind: EntryKind,
  id: string,
  change: { select: PickedAsset[]; deselect: PickedAsset[] },
  search: WindowSearch = directSearch(userId),
  options: Pick<ChoiceOptions, "album"> = {}
): Promise<ChoiceSaveResult | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null) return null;
  if (plan === "untimed") {
    return { picked: 0, swapped: 0, refused: 0, skipped: change.select.length };
  }
  // The same candidates the view listed: an album pick is proven against that album.
  const found = options.album
    ? await albumMatches(userId, plan, options.album)
    : await findMatches(userId, kind, id, plan, search, "none");
  const byKey = new Map(found.matched.map((m) => [refusalKey(m.provider, m.asset.id), m]));
  const rows = await prisma.entryPhotoLink.findMany({ where: { userId, ...fkOf(kind, id) } });
  const rowOf = new Map(rows.map((r) => [refusalKey(toKind(r.provider), r.assetId), r]));

  let picked = 0;
  let skipped = 0;
  const toCreate: SourcedAsset[] = [];
  for (const pick of change.select) {
    const key = refusalKey(pick.provider, pick.assetId);
    const row = rowOf.get(key);
    if (row && !row.refused && row.provenance === "manual") continue;
    if (row) {
      // Already linked, or refused earlier: the user's own pick now. The row exists
      // because the matcher once found the photo, but a refused one must still fit.
      if (row.refused && !byKey.has(key)) {
        skipped += 1;
        continue;
      }
      await prisma.entryPhotoLink.update({
        where: { id: row.id },
        data: { provenance: "manual", refused: false },
      });
      picked += 1;
      continue;
    }
    const match = byKey.get(key);
    if (match) toCreate.push(match);
    else skipped += 1;
  }
  picked += await writeLinks(userId, kind, id, toCreate, "manual");

  // An automatic link that a pick replaces goes quietly; the rest of the
  // unticked ones are explicit removals.
  let swapSlots = picked;
  let swapped = 0;
  let refused = 0;
  for (const drop of change.deselect) {
    const row = rowOf.get(refusalKey(drop.provider, drop.assetId));
    if (!row || row.refused) continue;
    if (row.provenance === "auto" && swapSlots > 0) {
      await prisma.entryPhotoLink.delete({ where: { id: row.id } });
      swapSlots -= 1;
      swapped += 1;
    } else {
      await prisma.entryPhotoLink.update({ where: { id: row.id }, data: { refused: true } });
      refused += 1;
    }
  }
  suggestionCache.delete(cacheKey(userId, kind, id));
  suggestionCache.delete(`${cacheKey(userId, kind, id)}:choices`);
  if (swapped + refused > 0) await repairAutoCovers(userId);
  return { picked, swapped, refused, skipped };
}

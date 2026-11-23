import { prisma } from "../../db";
import logger from "../../utils/logger";
import { startJob } from "../jobs/jobRegistry";
import { ImmichError } from "../immich/types";
import { PHOTO_SOURCE_KINDS, type PhotoSourceKind } from "../photoSource";
import { photoCapFor } from "./cap";
import { privacyCircleSet } from "../travtrack/privacyCircles";
import {
  autoLinkEnabled,
  memoizedSearch,
  mergeSources,
  recordRun,
  runVisits,
  type AutoLinkRun,
} from "../places/visitPhotoAutoLink";
import {
  ENTRY_FK,
  ENTRY_KINDS,
  entryIdsOf,
  planFor,
  type EntryKind,
  type EntryPlan,
} from "./entryKinds";
import {
  candidatesForWindow,
  directSearch,
  capMatches,
  matchAssets,
  refusalKey,
  type MatchSpec,
  type SourcedAsset,
  type SourceState,
  type WindowSearch,
} from "./matcher";
import { queueAutoCover, repairAutoCovers } from "../coverSuggestions/autoCover";

/**
 * Photo links for every entry type but the place visit (owner, 2026-11-21: "ja,
 * alle Bereiche"). One table (`EntryPhotoLink`), one matcher, one set of rules:
 * the entry's plan says when and where, `matcher.ts` decides, and the result is
 * written as LINKS with provenance `auto`. A removal never deletes: the row is
 * marked `refused`, so the next pass does not bring the picture back.
 */

/** Candidates the choose view lists at most — a two-week stay holds a camera roll. */
export const ENTRY_CHOICE_LIMIT = 60;

export interface EntryLinkDto {
  id: string;
  /** Where the thumbnail is served — ownership-checked, streamed from its own source. */
  url: string;
  provider: PhotoSourceKind;
  assetId: string;
  provenance: "manual" | "auto";
  takenAt: string | null;
  mimetype: string;
}

export interface EntrySuggestion {
  url: string;
  provider: PhotoSourceKind;
  assetId: string;
  takenAt: string | null;
  mimetype: string;
}

export interface EntrySuggestions {
  suggestions: EntrySuggestion[];
  /** What each source answered, per source; `truncated` means more photos than one search reads. */
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
  /** True when the entry has no usable time or position, so there is nothing to suggest. */
  untimed: boolean;
  /** Candidates found in all; `suggestions` holds at most ENTRY_CHOICE_LIMIT of them. */
  total?: number;
  /** True when `suggestions` is cut short of `total`, so the view says "N von M". */
  thinned?: boolean;
}

export const fkOf = (kind: EntryKind, id: string) => ({ [ENTRY_FK[kind]]: id });

export const toKind = (p: string): PhotoSourceKind =>
  (PHOTO_SOURCE_KINDS as readonly string[]).includes(p) ? (p as PhotoSourceKind) : "immich";

/** Does the entry exist and belong to the caller? */
export async function ownsEntry(userId: string, kind: EntryKind, id: string): Promise<boolean> {
  return (await planFor(userId, kind, id)) !== null;
}

export async function listEntryLinks(
  userId: string,
  kind: EntryKind,
  id: string
): Promise<EntryLinkDto[] | null> {
  if (!(await ownsEntry(userId, kind, id))) return null;
  const rows = await prisma.entryPhotoLink.findMany({
    where: { userId, ...fkOf(kind, id), refused: false },
    orderBy: [{ takenAt: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    url: `/api/v1/entry-photos/${kind}/${id}/photos/${r.id}/file`,
    provider: toKind(r.provider),
    assetId: r.assetId,
    provenance: r.provenance === "auto" ? "auto" : "manual",
    takenAt: r.takenAt?.toISOString() ?? null,
    mimetype: r.mimetype,
  }));
}

export interface Found {
  matched: SourcedAsset[];
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
  windows: { start: Date; end: Date }[];
}

/**
 * What the matcher finds for the entry, minus refusals and what is already
 * linked. Every leg of the plan is searched; a failing source is in `sources`,
 * never a silent empty result.
 */
export async function findMatches(
  userId: string,
  kind: EntryKind,
  id: string,
  plan: Exclude<EntryPlan, "untimed">,
  search: WindowSearch,
  /** `refused`: only refusals are excluded, so a linked photo that still fits shows up again. */
  excluding: "known" | "refused" | "none" = "known"
): Promise<Found> {
  const rows = await prisma.entryPhotoLink.findMany({
    where: { userId, ...fkOf(kind, id) },
    select: { provider: true, assetId: true, refused: true },
  });
  // Linked or refused alike: neither is offered or linked again.
  const known = new Set(
    rows
      .filter((r) => excluding === "known" || (excluding === "refused" && r.refused))
      .map((r) => refusalKey(toKind(r.provider), r.assetId))
  );
  const zones = await privacyCircleSet(userId);
  const matched = new Map<string, SourcedAsset>();
  let sources: Found["sources"] = {};
  for (const leg of plan.legs) {
    const { sources: s, candidates } = await candidatesForWindow(search, leg.window);
    sources = mergeSources(sources, s);
    const spec: MatchSpec = {
      window: leg.window,
      locations: leg.locations,
      circles: zones(leg.window.start.getTime()),
      refused: known,
    };
    for (const m of matchAssets(candidates, spec)) {
      matched.set(refusalKey(m.provider, m.asset.id), m);
    }
  }
  const sorted = [...matched.values()].sort(
    (a, b) =>
      Date.parse(a.asset.fileCreatedAt!) - Date.parse(b.asset.fileCreatedAt!) ||
      a.asset.id.localeCompare(b.asset.id)
  );
  return { matched: sorted, sources, windows: plan.legs.map((l) => l.window) };
}

/** Held for a minute so the thumbnail route can check an id against the list the client saw. */
const SUGGESTION_TTL_MS = 60_000;
export const suggestionCache = new Map<string, { at: number; value: EntrySuggestions }>();
export const cacheKey = (userId: string, kind: EntryKind, id: string) => `${userId}:${kind}:${id}`;

export async function entrySuggestionsFor(
  userId: string,
  kind: EntryKind,
  id: string,
  search: WindowSearch = directSearch(userId)
): Promise<EntrySuggestions | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null) return null;
  if (plan === "untimed") return { suggestions: [], sources: {}, untimed: true };
  const found = await findMatches(userId, kind, id, plan, search);
  const value: EntrySuggestions = {
    untimed: false,
    sources: found.sources,
    // Cut to the limit, but never silently: `total`/`thinned` let the view say how many it left out.
    total: found.matched.length,
    thinned: found.matched.length > ENTRY_CHOICE_LIMIT,
    suggestions: found.matched.slice(0, ENTRY_CHOICE_LIMIT).map(({ provider, asset }) => ({
      url: `/api/v1/entry-photos/${kind}/${id}/photo-suggestions/${provider}/${asset.id}/file`,
      provider,
      assetId: asset.id,
      takenAt: asset.fileCreatedAt,
      mimetype: asset.mimeType,
    })),
  };
  const now = Date.now();
  for (const [key, held] of suggestionCache) {
    if (now - held.at > SUGGESTION_TTL_MS) suggestionCache.delete(key);
  }
  suggestionCache.set(cacheKey(userId, kind, id), { at: now, value });
  return value;
}

/** An id is only served for a suggestion the server itself found, as for visits. */
export function isCachedSuggestion(
  userId: string,
  kind: EntryKind,
  id: string,
  provider: PhotoSourceKind,
  assetId: string
): boolean {
  return [cacheKey(userId, kind, id), `${cacheKey(userId, kind, id)}:choices`].some((key) => {
    const hit = suggestionCache.get(key);
    if (!hit || Date.now() - hit.at > SUGGESTION_TTL_MS) return false;
    return hit.value.suggestions.some((s) => s.provider === provider && s.assetId === assetId);
  });
}

export async function writeLinks(
  userId: string,
  kind: EntryKind,
  id: string,
  assets: SourcedAsset[],
  provenance: "manual" | "auto"
): Promise<number> {
  if (assets.length === 0) return 0;
  const { count } = await prisma.entryPhotoLink.createMany({
    data: assets.map(({ provider, asset }) => ({
      userId,
      ...fkOf(kind, id),
      provider,
      assetId: asset.id,
      provenance,
      mimetype: asset.mimeType,
      takenAt: asset.fileCreatedAt ? new Date(asset.fileCreatedAt) : null,
    })),
    // Two passes racing on one entry: the unique key decides, not a throw.
    skipDuplicates: true,
  });
  if (count > 0) queueAutoCover(userId);
  return count;
}

export interface PickedAsset {
  provider: PhotoSourceKind;
  assetId: string;
}

/**
 * Link the picks the user chose from the suggestions. An id that is not among
 * the entry's suggestions (searched again now) is skipped and counted, never
 * linked blind: a row is a grant to read that asset.
 */
export async function linkPicked(
  userId: string,
  kind: EntryKind,
  id: string,
  picks: PickedAsset[],
  search: WindowSearch = directSearch(userId)
): Promise<{ linked: number; skipped: number } | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null) return null;
  if (plan === "untimed") return { linked: 0, skipped: picks.length };
  const found = await findMatches(userId, kind, id, plan, search);
  const byKey = new Map(found.matched.map((m) => [refusalKey(m.provider, m.asset.id), m]));
  const proven = picks.flatMap((p) => byKey.get(refusalKey(p.provider, p.assetId)) ?? []);
  const linked = await writeLinks(userId, kind, id, proven, "manual");
  suggestionCache.delete(cacheKey(userId, kind, id));
  suggestionCache.delete(`${cacheKey(userId, kind, id)}:choices`);
  return { linked, skipped: picks.length - proven.length };
}

/** Remove one link; the row stays as a refusal so no pass brings it back. */
export async function removeLink(
  userId: string,
  kind: EntryKind,
  id: string,
  linkId: string
): Promise<boolean> {
  const { count } = await prisma.entryPhotoLink.updateMany({
    where: { id: linkId, userId, ...fkOf(kind, id), refused: false },
    data: { refused: true },
  });
  suggestionCache.delete(cacheKey(userId, kind, id));
  suggestionCache.delete(`${cacheKey(userId, kind, id)}:choices`);
  if (count > 0) await repairAutoCovers(userId);
  return count > 0;
}

/** "Alle automatisch verknüpften entfernen": each becomes a refusal. */
export async function removeAutoLinks(
  userId: string,
  kind: EntryKind,
  id: string
): Promise<number | null> {
  if (!(await ownsEntry(userId, kind, id))) return null;
  const { count } = await prisma.entryPhotoLink.updateMany({
    where: { userId, ...fkOf(kind, id), provenance: "auto", refused: false },
    data: { refused: true },
  });
  suggestionCache.delete(cacheKey(userId, kind, id));
  suggestionCache.delete(`${cacheKey(userId, kind, id)}:choices`);
  if (count > 0) await repairAutoCovers(userId);
  return count;
}

/** Offer the refused ones again (their rows go). */
export async function clearRefusals(
  userId: string,
  kind: EntryKind,
  id: string
): Promise<number | null> {
  if (!(await ownsEntry(userId, kind, id))) return null;
  const { count } = await prisma.entryPhotoLink.deleteMany({
    where: { userId, ...fkOf(kind, id), refused: true },
  });
  suggestionCache.delete(cacheKey(userId, kind, id));
  suggestionCache.delete(`${cacheKey(userId, kind, id)}:choices`);
  return count;
}

export interface EntryOutcome {
  linked: number;
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
}

/**
 * Link the photos that belong to one entry. Idempotent; an untimed entry
 * matches nothing. Automatic links whose capture time falls outside every
 * window (the entry was moved) are dropped first; a user's own picks never.
 */
export async function autoLinkEntry(
  userId: string,
  kind: EntryKind,
  id: string,
  search: WindowSearch = directSearch(userId)
): Promise<EntryOutcome | null> {
  const plan = await planFor(userId, kind, id);
  if (plan === null) return null;
  const fk = fkOf(kind, id);
  if (plan === "untimed") {
    // The entry lost its time or position: what it was linked for no longer holds.
    await prisma.entryPhotoLink.deleteMany({
      where: { userId, ...fk, provenance: "auto", refused: false },
    });
    return { linked: 0, sources: {} };
  }
  // Outside EVERY window: a photo between two flight windows is outside both.
  await prisma.entryPhotoLink.deleteMany({
    where: {
      userId,
      ...fk,
      provenance: "auto",
      refused: false,
      takenAt: { not: null },
      AND: plan.legs.map((l) => ({
        OR: [{ takenAt: { lt: l.window.start } }, { takenAt: { gt: l.window.end } }],
      })),
    },
  });
  // What still fits, linked or not (only refusals excluded, no cap): an automatic link
  // that no longer fits — the entry's position moved, its dates stayed — goes, but only
  // when its own source answered, so a failing source never costs a good link.
  const fits = await findMatches(userId, kind, id, plan, search, "refused");
  const stillFits = new Set(fits.matched.map((m) => refusalKey(m.provider, m.asset.id)));
  const autoLinks = await prisma.entryPhotoLink.findMany({
    where: { userId, ...fk, provenance: "auto", refused: false },
    select: { id: true, provider: true, assetId: true },
  });
  const stale = autoLinks.filter(
    (l) =>
      fits.sources[toKind(l.provider)] === "ok" &&
      !stillFits.has(refusalKey(toKind(l.provider), l.assetId))
  );
  if (stale.length > 0) {
    // Provenance is re-checked in the same statement: a user may have picked
    // this very photo since the read above, and a pick must survive the pass.
    await prisma.entryPhotoLink.deleteMany({
      where: { id: { in: stale.map((l) => l.id) }, provenance: "auto", refused: false },
    });
  }
  const linkedKeys = new Set(
    (
      await prisma.entryPhotoLink.findMany({
        where: { userId, ...fk, refused: false },
        select: { provider: true, assetId: true },
      })
    ).map((l) => refusalKey(toKind(l.provider), l.assetId))
  );
  // The user's own picks count toward the cap, so a swapped choice leaves no room.
  const room = Math.max(0, (await photoCapFor(userId)) - linkedKeys.size);
  const fresh = capMatches(
    fits.matched.filter((m) => !linkedKeys.has(refusalKey(m.provider, m.asset.id))),
    room
  );
  const linked = await writeLinks(userId, kind, id, fresh, "auto");
  return { linked, sources: fits.sources };
}

export interface EntryRef {
  kind: EntryKind;
  id: string;
}

/** Everything the account has that can carry photos. */
export async function allEntryRefs(userId: string): Promise<EntryRef[]> {
  const lists = await Promise.all(
    ENTRY_KINDS.map(async (kind) => (await entryIdsOf(userId, kind)).map((id) => ({ kind, id })))
  );
  return lists.flat();
}

const FAILURES_KEPT = 10;

/** The entry pass; folded into one run record with the visits by `autoLinkEverything`. */
export async function runEntries(
  userId: string,
  refs: EntryRef[] | null,
  onProgress?: (done: number, total: number) => void
): Promise<AutoLinkRun> {
  const list = refs ?? (await allEntryRefs(userId));
  const search = memoizedSearch(directSearch(userId));
  let run: AutoLinkRun = {
    visits: 0,
    linked: 0,
    failedVisits: 0,
    failures: [],
    truncatedVisits: 0,
    sources: {},
  };
  let done = 0;
  for (const ref of list) {
    if (!(await autoLinkEnabled(userId))) break;
    try {
      const outcome = await autoLinkEntry(userId, ref.kind, ref.id, search);
      if (outcome) {
        run = {
          ...run,
          visits: run.visits + 1,
          linked: run.linked + outcome.linked,
          truncatedVisits:
            run.truncatedVisits + (Object.values(outcome.sources).includes("truncated") ? 1 : 0),
          sources: mergeSources(run.sources, outcome.sources),
        };
      }
    } catch (error) {
      logger.error({
        message: "entry_photo_auto_link_failed",
        context: { userId, ...ref },
        error,
      });
      run = {
        ...run,
        failedVisits: run.failedVisits + 1,
        failures: [
          ...run.failures,
          {
            visitId: `${ref.kind}:${ref.id}`,
            reason: error instanceof ImmichError ? error.kind : "unknown",
          },
        ].slice(0, FAILURES_KEPT),
      };
    }
    onProgress?.(++done, list.length);
  }
  return run;
}

function mergeRuns(a: AutoLinkRun, b: AutoLinkRun): AutoLinkRun {
  return {
    visits: a.visits + b.visits,
    linked: a.linked + b.linked,
    failedVisits: a.failedVisits + b.failedVisits,
    failures: [...a.failures, ...b.failures].slice(0, FAILURES_KEPT),
    truncatedVisits: a.truncatedVisits + b.truncatedVisits,
    sources: mergeSources(a.sources, b.sources),
  };
}

/** Every dated visit and every entry of the account, recorded as ONE run. */
export async function autoLinkEverything(
  userId: string,
  onProgress?: (done: number, total: number) => void
): Promise<AutoLinkRun> {
  let visitTotal = 0;
  const visits = await runVisits(
    userId,
    null,
    (done, total) => {
      visitTotal = total;
      onProgress?.(done, total);
    },
    false
  );
  const entries = await runEntries(userId, null, (done, total) =>
    onProgress?.(visitTotal + done, visitTotal + total)
  );
  const run = mergeRuns(visits, entries);
  if (run.visits + run.failedVisits > 0) await recordRun(userId, run);
  return run;
}

/**
 * A new or changed entry gets its pass in the background, after the write has
 * answered. Never throws: a failure is logged and lands in the job, never in the
 * save the user just made.
 */
export function scheduleEntryAutoLink(userId: string, kind: EntryKind, id: string): void {
  void (async () => {
    if (!(await autoLinkEnabled(userId))) return;
    startJob("placeVisitPhotos.autoLink", userId, async () => {
      const run = await runEntries(userId, [{ kind, id }]);
      await recordRun(userId, run);
      return run;
    });
  })().catch((error) =>
    logger.error({ message: "entry_photo_auto_link_schedule_failed", context: { userId }, error })
  );
}

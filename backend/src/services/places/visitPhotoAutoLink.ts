import { prisma } from "../../db";
import logger from "../../utils/logger";
import { startJob } from "../jobs/jobRegistry";
import {
  candidatesForWindow,
  directSearch,
  capMatches,
  matchAssets,
  refusalKey,
  type MatchSpec,
  type SourceState,
  type WindowSearch,
} from "../photoLinking/matcher";
import { photoCapFor } from "../photoLinking/cap";
import { PHOTO_SOURCE_KINDS, type PhotoSourceKind } from "../photoSource";
import { toPhotoSourceKind } from "../photoSource/connection";
import { privacyCircleSet } from "../travtrack/privacyCircles";
import { ImmichError } from "../immich/types";
import { PHOTO_RADIUS_KM } from "./visitDateSuggestions";
import { anchorOf, dayWindow } from "./visitPhotoSuggestions";
import { linkAssetsToVisit } from "./visitPhotoLinks";
import { refusedIds } from "./visitPhotoRefusals";

/**
 * Automatic photo links for place visits (owner, 2026-11-21: "dass z. B. die
 * Immich- oder PhotoPrism-Bilder von dem Standort automatisch verknüpft
 * werden"). The matching rules are `photoLinking/matcher.ts`; this file builds
 * a visit's {@link MatchSpec} — its local day and a point at the place — and
 * writes the result as LINKS (never copies) with provenance `auto`.
 *
 * Everything here is own-account only: the visit is looked up by `userId`, the
 * photo sources are the account's own connections, and the privacy zones are
 * the account's own.
 */

export interface AutoLinkOutcome {
  linked: number;
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
}

/** Is the switch on for this account? Default on: the owner asked for it. */
export async function autoLinkEnabled(userId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { autoLinkVisitPhotos: true },
  });
  return row?.autoLinkVisitPhotos ?? true;
}

async function linkedKeys(visitId: string): Promise<Set<string>> {
  const rows = await prisma.placeVisitPhoto.findMany({
    where: { placeVisitId: visitId, immichAssetId: { not: null } },
    select: { immichAssetId: true, provider: true },
  });
  return new Set(rows.map((r) => refusalKey(toPhotoSourceKind(r.provider), r.immichAssetId!)));
}

/** Remember each window's search for one run: many visits share a day. */
export function memoizedSearch(inner: WindowSearch): WindowSearch {
  const held = new Map<string, Promise<Awaited<ReturnType<WindowSearch>>>>();
  return (provider, window) => {
    const key = `${provider}:${window.start.getTime()}:${window.end.getTime()}`;
    let hit = held.get(key);
    if (!hit) {
      hit = inner(provider, window);
      held.set(key, hit);
    }
    return hit;
  };
}

/**
 * Link the photos that belong to one visit. Idempotent: a second pass finds
 * the same earliest matches and links nothing new. An undated visit matches
 * nothing. A failing source is reported in `sources`, not thrown.
 */
export async function autoLinkVisit(
  userId: string,
  visitId: string,
  search: WindowSearch = directSearch(userId)
): Promise<AutoLinkOutcome | null> {
  const anchor = await anchorOf(userId, visitId);
  if (anchor === null) return null;
  if (anchor === "undated") return { linked: 0, sources: {} };

  const window = dayWindow(anchor);
  // A visit moved to another day: its automatic links from the old day no
  // longer belong to it. Only links whose capture time is known and outside the
  // new day go; a user's own picks (provenance manual) are never touched.
  await prisma.placeVisitPhoto.deleteMany({
    where: {
      placeVisitId: visitId,
      provenance: "auto",
      takenAt: { not: null },
      OR: [{ takenAt: { lt: window.start } }, { takenAt: { gt: window.end } }],
    },
  });
  // The user's own library picks count toward the cap: a swapped choice must not
  // leave room for the matcher to link a replacement.
  const [cap, existingLinks] = await Promise.all([
    photoCapFor(userId),
    prisma.placeVisitPhoto.count({
      where: { placeVisitId: visitId, immichAssetId: { not: null } },
    }),
  ]);
  const [{ sources, candidates }, circles, refused, onVisit] = await Promise.all([
    candidatesForWindow(search, window),
    privacyCircleSet(userId).then((at) => at(window.start.getTime())),
    refusedIds(visitId),
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId },
      select: { tripPhoto: { select: { immichAssetId: true, provider: true } } },
    }),
  ]);
  // A library photo already on the visit through its trip photo is the same
  // picture twice.
  const viaTrip = new Set(
    onVisit.flatMap((row) =>
      row.tripPhoto?.immichAssetId
        ? [refusalKey(toPhotoSourceKind(row.tripPhoto.provider), row.tripPhoto.immichAssetId)]
        : []
    )
  );
  const spec: MatchSpec = {
    window,
    locations: [{ kind: "point", lat: anchor.lat, lon: anchor.lon, radiusKm: PHOTO_RADIUS_KM }],
    circles,
    refused: new Set([...refused.library, ...viaTrip]),
  };
  // The cap bounds what the visit holds, not what one pass adds.
  const room = Math.max(0, cap - existingLinks);
  const linkedAlready = await linkedKeys(visitId);
  const fresh = matchAssets(candidates, spec).filter(
    (m) => !linkedAlready.has(refusalKey(m.provider, m.asset.id))
  );
  const linked = await linkAssetsToVisit(visitId, capMatches(fresh, room), "auto");
  return { linked, sources };
}

export interface AutoLinkRun {
  visits: number;
  linked: number;
  /** Visits whose pass threw (logged); the run went on without them. */
  failedVisits: number;
  /** Why, for the first few of them: the failure kind, else `unknown`. */
  failures: { visitId: string; reason: string }[];
  /** Visits where a source had more photos than one search reads. */
  truncatedVisits: number;
  /** Worst answer per source over the run: a failure beats "ok" beats "notConfigured". */
  sources: Partial<Record<PhotoSourceKind, SourceState>>;
}

export const rank = (s: SourceState): number => (s === "ok" ? 1 : s === "notConfigured" ? 0 : 2);

/** Enough to explain a failing run in the settings; the rest are in the log. */
const FAILURES_KEPT = 10;

export function mergeSources(
  into: AutoLinkRun["sources"],
  from: AutoLinkOutcome["sources"]
): AutoLinkRun["sources"] {
  const out = { ...into };
  for (const kind of PHOTO_SOURCE_KINDS) {
    const next = from[kind];
    if (next !== undefined && (out[kind] === undefined || rank(next) > rank(out[kind]!))) {
      out[kind] = next;
    }
  }
  return out;
}

/** Persist the run's outcome so the settings can show a failing source. */
export async function recordRun(userId: string, run: AutoLinkRun): Promise<void> {
  await prisma.userSettings.updateMany({
    where: { userId },
    data: {
      visitPhotoAutoLinkLastRun: {
        at: new Date().toISOString(),
        linked: run.linked,
        failedVisits: run.failedVisits,
        failures: run.failures,
        truncatedVisits: run.truncatedVisits,
        sources: run.sources,
      },
    },
  });
}

/**
 * Link photos for the given visits (or every dated visit of the account) and
 * record the outcome. A visit that throws does not stop the run, but it is
 * counted and logged; a source that fails is in `sources` for the settings.
 */
export async function autoLinkVisits(
  userId: string,
  visitIds: string[] | null,
  onProgress?: (done: number, total: number) => void
): Promise<AutoLinkRun> {
  return runVisits(userId, visitIds, onProgress, true);
}

/** The visit pass; `record: false` lets a caller fold other entry types into one record. */
export async function runVisits(
  userId: string,
  visitIds: string[] | null,
  onProgress: ((done: number, total: number) => void) | undefined,
  record: boolean
): Promise<AutoLinkRun> {
  const ids =
    visitIds ??
    (
      await prisma.placeVisit.findMany({
        where: { userId, visitedAt: { not: null } },
        select: { id: true },
        orderBy: { visitedAt: "asc" },
      })
    ).map((v) => v.id);
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
  for (const id of ids) {
    // Switching off stops a pass already under way, not only the next one.
    if (!(await autoLinkEnabled(userId))) break;
    try {
      const outcome = await autoLinkVisit(userId, id, search);
      if (outcome) {
        run = {
          ...run,
          truncatedVisits:
            run.truncatedVisits + (Object.values(outcome.sources).includes("truncated") ? 1 : 0),
          visits: run.visits + 1,
          linked: run.linked + outcome.linked,
          sources: mergeSources(run.sources, outcome.sources),
        };
      }
    } catch (error) {
      logger.error({ message: "visit_photo_auto_link_failed", context: { userId, id }, error });
      run = {
        ...run,
        failedVisits: run.failedVisits + 1,
        failures: [
          ...run.failures,
          { visitId: id, reason: error instanceof ImmichError ? error.kind : "unknown" },
        ].slice(0, FAILURES_KEPT),
      };
    }
    onProgress?.(++done, ids.length);
  }
  if (record && ids.length > 0) await recordRun(userId, run);
  return run;
}

/**
 * A new or changed visit gets its pass in the background, after the write has
 * answered. A failure is logged and lands in the job; it never fails the save
 * the user just made.
 */
export function scheduleVisitAutoLink(userId: string, visitId: string): void {
  void (async () => {
    if (!(await autoLinkEnabled(userId))) return;
    startJob("placeVisitPhotos.autoLink", userId, () => autoLinkVisits(userId, [visitId]));
  })().catch((error) =>
    logger.error({ message: "visit_photo_auto_link_schedule_failed", context: { userId }, error })
  );
}

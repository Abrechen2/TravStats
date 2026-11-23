/**
 * Automatic covers (owner, 2026-11-23): a trip WITHOUT a cover gets one from the
 * account's OWN photos — never stock or Wikimedia — when the cover scorer is sure.
 *
 * "Sure" is: the best photo scores at least `AUTO_MIN_SCORE` and leads the second
 * by at least `AUTO_MIN_LEAD`. Anything less stays a suggestion the person picks.
 * The write goes through `fillEmptyCover` only (atomic "where cover is null"), so a
 * cover a person set a moment earlier can never be overwritten, and the result is
 * marked `auto` so it can be replaced, re-framed or removed again.
 *
 * A source that cannot be read gives NO pick: a half-read library would rank the
 * photos it did get and crown a winner among the wrong ones.
 */
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { fillEmptyCover } from "../trip/tripCover";
import { suggestCover, type CoverSuggestion, type CoverSuggestions } from "./suggest";

export const AUTO_MIN_SCORE = 60;
export const AUTO_MIN_LEAD = 15;
/** Trips one account is looked at per run, and the pause between two of them. */
export const AUTO_MAX_TRIPS_PER_USER = 25;
const PAUSE_BETWEEN_TRIPS_MS = 500;
/** A burst of photo links (an album import) triggers ONE run, this long after the last. */
const TRIGGER_DELAY_MS = 90_000;

export type AutoCoverOutcome =
  "applied" | "disabled" | "hasCover" | "notSure" | "sourceFailed" | "noSuggestion" | "error";

/** The one rule: best ≥ 60 and ahead of the runner-up by ≥ 15. A lone photo has no rival. */
export function pickAutoCover(suggestions: CoverSuggestion[]): CoverSuggestion | null {
  const ranked = [...suggestions].sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best || best.score < AUTO_MIN_SCORE) return null;
  if (second && best.score - second.score < AUTO_MIN_LEAD) return null;
  return best;
}

/** The thumbnail URL and the cover URL of a photo differ only in `size=`. */
export function coverUrlOf(suggestion: CoverSuggestion): string {
  return suggestion.thumbUrl.replace("size=thumbnail", "size=preview");
}

/** The first source that could not be read (photos, or the "me" recognition), if any. */
function failedSource(result: CoverSuggestions): string | null {
  for (const s of result.sources) {
    if (s.photos !== "ok" && s.photos !== "notConfigured") return `${s.provider}:${s.photos}`;
    if (s.people !== "ok" && s.people !== "notSet" && s.people !== "notConfigured") {
      return `${s.provider}:people:${s.people}`;
    }
  }
  return null;
}

export async function autoCoverEnabled(userId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { autoCoverEnabled: true },
  });
  return row?.autoCoverEnabled ?? true;
}

export async function applyAutoCover(userId: string, tripId: string): Promise<AutoCoverOutcome> {
  if (!(await autoCoverEnabled(userId))) return "disabled";
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { coverImageUrl: true },
  });
  if (!trip || trip.coverImageUrl) return "hasCover";

  let result: CoverSuggestions;
  try {
    result = await suggestCover(userId, tripId);
  } catch (error) {
    logger.warn({ message: "auto_cover_suggest_failed", error, context: { tripId } });
    return "error";
  }
  const failed = failedSource(result);
  if (failed) {
    logger.warn({ message: "auto_cover_source_failed", context: { tripId, source: failed } });
    return "sourceFailed";
  }
  if (result.suggestions.length === 0) return "noSuggestion";
  const pick = pickAutoCover(result.suggestions);
  if (!pick) return "notSure";
  // The setting may have been switched off while the sources were read.
  if (!(await autoCoverEnabled(userId))) return "disabled";
  const applied = await fillEmptyCover(tripId, coverUrlOf(pick));
  if (applied) {
    logger.info({
      message: "auto_cover_set",
      context: { tripId, score: pick.score, type: pick.apply.type },
    });
  }
  return applied ? "applied" : "hasCover";
}

/** A trip with something to choose from: a gallery photo, a linked album or an entry's photo. */
const HAS_PHOTOS: Prisma.TripWhereInput = {
  OR: [
    { photos: { some: {} } },
    { immichAlbums: { some: {} } },
    { flights: { some: { entryPhotoLinks: { some: { refused: false } } } } },
    { lodgingStays: { some: { entryPhotoLinks: { some: { refused: false } } } } },
    { railJourneys: { some: { entryPhotoLinks: { some: { refused: false } } } } },
    { busJourneys: { some: { entryPhotoLinks: { some: { refused: false } } } } },
    { ferryJourneys: { some: { entryPhotoLinks: { some: { refused: false } } } } },
    { rentalBookings: { some: { entryPhotoLinks: { some: { refused: false } } } } },
  ],
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Cover-less trips of one account that have photos, newest first, bounded. */
export async function autoCoverCandidates(userId: string): Promise<string[]> {
  const trips = await prisma.trip.findMany({
    where: { userId, coverImageUrl: null, startDate: { not: null }, ...HAS_PHOTOS },
    select: { id: true },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    take: AUTO_MAX_TRIPS_PER_USER,
  });
  return trips.map((t) => t.id);
}

export async function runAutoCoverForUser(
  userId: string,
  pauseMs = PAUSE_BETWEEN_TRIPS_MS
): Promise<Record<AutoCoverOutcome, number>> {
  const counts: Record<AutoCoverOutcome, number> = {
    applied: 0,
    disabled: 0,
    hasCover: 0,
    notSure: 0,
    sourceFailed: 0,
    noSuggestion: 0,
    error: 0,
  };
  if (!(await autoCoverEnabled(userId))) {
    counts.disabled = 1;
    return counts;
  }
  for (const tripId of await autoCoverCandidates(userId)) {
    counts[await applyAutoCover(userId, tripId)]++;
    if (pauseMs > 0) await sleep(pauseMs);
  }
  return counts;
}

/** Nightly: every account that has not switched it off. */
export async function runAutoCoverSweep(
  pauseMs = PAUSE_BETWEEN_TRIPS_MS
): Promise<{ users: number; applied: number }> {
  const off = await prisma.userSettings.findMany({
    where: { autoCoverEnabled: false },
    select: { userId: true },
  });
  const users = await prisma.trip.findMany({
    where: {
      coverImageUrl: null,
      userId: { notIn: off.map((o) => o.userId) },
      ...HAS_PHOTOS,
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  let applied = 0;
  for (const { userId } of users) {
    try {
      applied += (await runAutoCoverForUser(userId, pauseMs)).applied;
    } catch (error) {
      logger.warn({ message: "auto_cover_user_failed", error, context: { userId } });
    }
  }
  logger.info({ message: "auto_cover_sweep_done", context: { users: users.length, applied } });
  return { users: users.length, applied };
}

const pending = new Map<string, NodeJS.Timeout>();

/**
 * Photos were just linked for this account (album, entry photo, import): look at its
 * cover-less trips once the burst is over. Fire-and-forget — a failure is logged, and
 * the nightly sweep is the safety net.
 */
export function queueAutoCover(userId: string): void {
  const existing = pending.get(userId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(userId);
    runAutoCoverForUser(userId).catch((error: unknown) => {
      logger.warn({ message: "auto_cover_trigger_failed", error, context: { userId } });
    });
  }, TRIGGER_DELAY_MS);
  timer.unref();
  pending.set(userId, timer);
}

/** Undo: removes the covers the server chose; a person's own cover is never matched. */
export async function removeAutoCovers(userId: string): Promise<number> {
  const { count } = await prisma.trip.updateMany({
    where: { userId, coverSource: "auto" },
    data: { coverImageUrl: null, coverCrop: Prisma.JsonNull, coverSource: null },
  });
  return count;
}

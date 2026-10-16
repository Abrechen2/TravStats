/**
 * Repair places a past visit should have taken out of the wishlist, and did
 * not (`visitPromotesPlace` in `shared/placeCounting.ts`).
 *
 * Until that rule, the visit writers asked "has it happened?" of the legacy
 * `visitedAt` column — the place's wall clock as fake UTC — which east of UTC
 * runs ahead of the real time. A visit logged in Korea within nine hours of
 * standing there read as a plan, so the place kept `visited = false` and was
 * missing from "Orte besucht" (24 places, measured on prod 2026-10-16).
 *
 * A place is promoted here only when the write path, asking the right
 * question, would have promoted it itself:
 *
 *   - it is not visited, and not a checklist row — unticking a curated item
 *     sets `visited = false` and deliberately KEEPS its visits, so a visit
 *     there is no evidence the user still means "been there";
 *   - it carries a DATED visit whose instant has passed AND that was recorded
 *     at or after that instant (with a few minutes of clock slack). A visit
 *     entered as a plan that has since come due is not proof the user went —
 *     no write path promotes on the clock alone, so neither does this.
 *     Undated visits are left out for the same reason as checklist rows: on a
 *     place that is not visited they are as likely a deliberate unmark.
 *
 * Idempotent: a promoted place is `visited` and no longer a candidate, and the
 * write itself is guarded by `visited = false`. DRY RUN unless `apply`.
 */
import { prisma } from "../../db";
import { visitPromotesPlace } from "../../shared/placeCounting";
import { now as clockNow } from "../../shared/time/clock";
import { recheckAchievements } from "../../utils/achievements";
import logger from "../../utils/logger";

/** How long after its own instant a visit may have been written and still count as "recorded after the fact" if the clocks disagree. */
export const RECORDED_AFTER_SLACK_MS = 5 * 60_000;

export interface VisitedFlagCandidate {
  placeId: string;
  userId: string;
  placeName: string;
  /** The visit that proves it — the earliest qualifying one. */
  visitId: string;
  visitInstant: Date;
  writtenVia: string | null;
}

export interface VisitedFlagReport {
  apply: boolean;
  /** Not-visited, non-checklist places that carry at least one visit. */
  scanned: number;
  candidates: VisitedFlagCandidate[];
  /** Rows actually written (0 on a dry run). */
  promoted: number;
}

interface VisitRow {
  id: string;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  createdAt: Date;
  writtenVia: string | null;
}

/** The visit's instant, when it has one, and whether it proves a past visit. */
function provingInstant(visit: VisitRow, now: Date): Date | null {
  const instant = visit.visitedAtUtc ?? visit.visitedAt;
  if (instant === null) return null;
  if (!visitPromotesPlace(visit, now)) return null;
  const recordedAfter = instant.getTime() <= visit.createdAt.getTime() + RECORDED_AFTER_SLACK_MS;
  return recordedAfter ? instant : null;
}

export async function backfillVisitedFlags(opts: {
  apply: boolean;
  userId?: string;
  now?: Date;
}): Promise<VisitedFlagReport> {
  const now = opts.now ?? clockNow();
  const places = await prisma.place.findMany({
    where: {
      visited: false,
      curatedItemId: null,
      visits: { some: {} },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: {
      id: true,
      userId: true,
      name: true,
      visits: {
        select: {
          id: true,
          visitedAt: true,
          visitedAtUtc: true,
          createdAt: true,
          writtenVia: true,
        },
        orderBy: [{ visitedAtUtc: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ userId: "asc" }, { name: "asc" }, { id: "asc" }],
  });

  const candidates: VisitedFlagCandidate[] = [];
  for (const place of places) {
    for (const visit of place.visits) {
      const instant = provingInstant(visit, now);
      if (instant === null) continue;
      candidates.push({
        placeId: place.id,
        userId: place.userId,
        placeName: place.name,
        visitId: visit.id,
        visitInstant: instant,
        writtenVia: visit.writtenVia,
      });
      break;
    }
  }

  let promoted = 0;
  if (opts.apply && candidates.length > 0) {
    const result = await prisma.place.updateMany({
      where: { id: { in: candidates.map((c) => c.placeId) }, visited: false },
      data: { visited: true },
    });
    promoted = result.count;
    for (const userId of new Set(candidates.map((c) => c.userId))) {
      await recheckAchievements(userId, "visited flag backfill");
    }
  }

  logger.info(
    {
      operation: "visited_flag_backfill",
      apply: opts.apply,
      scanned: places.length,
      candidates: candidates.length,
      promoted,
    },
    "Visited-flag backfill finished"
  );
  return { apply: opts.apply, scanned: places.length, candidates, promoted };
}

import { prisma } from "../../../db";
import { loadHomePeriods } from "../../home/homeStore";
import { periodAt, type HomePeriod } from "../../../utils/homeAirport";
import { meters, RADIUS_METERS } from "./detect";

/**
 * Daily places are not findings.
 *
 * Every scan re-suggested home, the office and the gym, because the only
 * memory was "a row overlapping this interval": a new day is a new interval.
 * Two rules end that without guessing:
 *
 *  - a stay at the user's CONFIRMED residence for that day is never suggested.
 *    An unconfirmed residence is the old home airport's position, and a stay
 *    at an airport is a legitimate question.
 *  - a location the user has rejected `REJECTIONS_TO_SILENCE` times within
 *    `RADIUS_METERS` is not suggested again. One rejection is an answer about
 *    one visit; two are an answer about the place.
 */
export const HOME_RADIUS_M = 300;
export const REJECTIONS_TO_SILENCE = 2;
/** Newest rejections considered — bounds the read on an account that has answered for years. */
const REJECTION_MEMORY_CAP = 5000;

export interface SuppressionContext {
  periods: readonly HomePeriod[];
  rejected: readonly { lat: number; lon: number }[];
}

export async function loadSuppression(userId: string): Promise<SuppressionContext> {
  const [periods, rows] = await Promise.all([
    loadHomePeriods(userId),
    prisma.dawarichStay.findMany({
      where: { userId, status: "rejected" },
      select: { sourceLat: true, sourceLon: true, evidence: true },
      orderBy: [{ resolvedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: REJECTION_MEMORY_CAP,
    }),
  ]);
  // A rejected market/venue finding answers for that venue, which has its own
  // identity memory; it says nothing about a plain stop nearby.
  const rejected = rows
    .filter((r) => !(r.evidence as { market?: unknown } | null)?.market)
    .map((r) => ({ lat: r.sourceLat, lon: r.sourceLon }));
  return { periods, rejected };
}

export function suppressionReason(
  candidate: { lat: number; lon: number },
  day: string,
  context: SuppressionContext
): "home" | "rejected" | null {
  const period = periodAt(context.periods, day);
  if (
    period?.residenceConfirmed &&
    period.residence &&
    meters(period.residence, candidate) <= HOME_RADIUS_M
  )
    return "home";
  const rejections = context.rejected.filter((r) => meters(r, candidate) <= RADIUS_METERS).length;
  return rejections >= REJECTIONS_TO_SILENCE ? "rejected" : null;
}

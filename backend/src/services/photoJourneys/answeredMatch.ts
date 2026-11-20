import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";

/**
 * Has the user already answered a burst like this one?
 *
 * The fingerprint is an exact key (UTC start day + a 0.1 degree cell). It
 * breaks exactly when a photo library grows the way it is meant to: earlier
 * photos move the start day, a median that crosses a rounding edge moves the
 * cell, and the same forgotten trip comes back as a brand-new pending row for
 * a user who dismissed it. So an answer also holds for any later burst that
 * overlaps the answered one in time and lies near it — the rule
 * `dawarich/stays/scanCandidates.ts` already applies to stays.
 */

/** Slack either side of an answered span, so a burst that starts or ends a day off still matches. */
const TIME_PAD_MS = 24 * 3_600_000;
/** A journey burst's median wanders by tens of km as photos are added. */
export const JOURNEY_MATCH_KM = 30;
/** A visit stop is a kilometre-scale object. */
export const VISIT_MATCH_KM = 1.5;

export interface AnsweredSpan {
  startMs: number;
  endMs: number;
  lat: number;
  lon: number;
}

export interface AnsweredIndex {
  covers(burst: {
    startMs: number;
    endMs: number;
    position: { lat: number; lon: number } | null;
  }): boolean;
}

export function buildAnsweredIndex(spans: readonly AnsweredSpan[], maxKm: number): AnsweredIndex {
  return {
    covers(burst) {
      if (burst.position === null) return false;
      const { position } = burst;
      return spans.some(
        (s) =>
          burst.startMs <= s.endMs + TIME_PAD_MS &&
          burst.endMs >= s.startMs - TIME_PAD_MS &&
          haversineKm(position, s) <= maxKm
      );
    },
  };
}

/** The user's answered (non-pending) rows of one family, as spans. */
export async function loadAnsweredIndex(
  userId: string,
  family: "journey" | "visit"
): Promise<AnsweredIndex> {
  const rows = await prisma.photoJourney.findMany({
    where: {
      userId,
      status: { not: "pending" },
      kind: family === "visit" ? "visit" : { not: "visit" },
    },
    select: { startDate: true, endDate: true, lat: true, lon: true },
  });
  return buildAnsweredIndex(
    rows.map((r) => ({
      startMs: r.startDate.getTime(),
      endMs: r.endDate.getTime(),
      lat: r.lat,
      lon: r.lon,
    })),
    family === "visit" ? VISIT_MATCH_KM : JOURNEY_MATCH_KM
  );
}

import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { dayAfter, midnightOf } from "../range";
import { readSafeTravTrack } from "../readSafe";
import { DAY_POINT_CAP } from "../dayView";
import { travTrackLegs } from "./index";
import type { Leg, LegMode } from "./types";

/**
 * `PUT /travtrack/legs/mode` (spec 2026-11-03-travtrack-legs, §2/§3): store
 * the owner's correction of a stretch's mode, or reset it with `null`, and
 * answer the recomputed leg.
 *
 * The correction is bound to the span sent, not to a leg id: it applies to
 * every derived leg it covers by more than half, so it survives late points.
 * A span under no leg is `TRAVTRACK_LEG_NOT_FOUND` and stores nothing; a
 * reset removes the stored row first (a correction may be the only thing left
 * of a leg the points no longer make) and then says so if no leg is there.
 */

export type LegSpan = { fromMs: number; untilMs: number };

/** The legs derived on the profile days the span touches — as `GET /travtrack/day` shows them. */
async function legsAround(userId: string, span: LegSpan): Promise<Leg[]> {
  const { zone } = await profileZoneOf(userId);
  const first = localDay(new Date(span.fromMs), zone);
  const last = localDay(new Date(span.untilMs - 1), zone);
  const days = [first];
  for (let d = first; d !== last && days.length < 4;) {
    d = dayAfter(d);
    days.push(d);
  }
  const legs: Leg[] = [];
  for (const day of days) {
    const window = {
      fromMs: midnightOf(day, zone).getTime(),
      untilMs: midnightOf(dayAfter(day), zone).getTime(),
    };
    const read = await readSafeTravTrack(userId, window, DAY_POINT_CAP);
    legs.push(...(await travTrackLegs(userId, window, read)).legs);
  }
  return legs;
}

/** The leg the correction mostly lies on (it applies to every leg it covers by more than half). */
function under(legs: readonly Leg[], span: LegSpan): Leg[] {
  return legs.filter((l) => overlapShare(l, span) > 0.5);
}

const notFound = () => new AppError("No leg under that span", 404, "TRAVTRACK_LEG_NOT_FOUND");

export async function setLegMode(
  userId: string,
  span: LegSpan,
  mode: LegMode | null
): Promise<Leg> {
  if (mode === null) {
    // Every correction that holds a leg under the span goes, not only the one with
    // these exact bounds: a late point may have shifted the leg since it was set.
    const hit = under(await legsAround(userId, span), span);
    const stored = await prisma.travTrackLegMode.findMany({
      where: {
        userId,
        fromMs: { lt: BigInt(span.untilMs) },
        untilMs: { gt: BigInt(span.fromMs) },
      },
      select: { id: true, fromMs: true, untilMs: true },
    });
    const drop = stored
      .filter(
        (r) =>
          (Number(r.fromMs) === span.fromMs && Number(r.untilMs) === span.untilMs) ||
          hit.some(
            (l) => overlapShare(l, { fromMs: Number(r.fromMs), untilMs: Number(r.untilMs) }) > 0.5
          )
      )
      .map((r) => r.id);
    await prisma.travTrackLegMode.deleteMany({ where: { userId, id: { in: drop } } });
  } else {
    const hit = under(await legsAround(userId, span), span);
    if (hit.length === 0) throw notFound();
    await prisma.travTrackLegMode.upsert({
      where: {
        userId_fromMs_untilMs: {
          userId,
          fromMs: BigInt(span.fromMs),
          untilMs: BigInt(span.untilMs),
        },
      },
      create: { userId, fromMs: BigInt(span.fromMs), untilMs: BigInt(span.untilMs), mode },
      update: { mode },
    });
  }
  const hit = under(await legsAround(userId, span), span);
  if (hit.length === 0) throw notFound();
  return hit.reduce((best, l) => (overlapShare(l, span) > overlapShare(best, span) ? l : best));
}

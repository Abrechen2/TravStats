import { midnightOf } from "../range";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { providerIs } from "../../locationProvider/provider";
import { loadEverydaySummary, type EverydaySummary } from "./load";
import type { MotionClass } from "./plausible";

/**
 * The everyday figures as the API states them (forgejo#400): rounded, and
 * abstaining. `null` when TravTrack is not this account's working location
 * source (`providerIs` — chosen AND available, so a switched-off server or the
 * shared demo account reads nothing), or when the window holds no
 * privacy-safe fix.
 */

export type TravTrackYearStats = {
  kmGround: number | null;
  daysRecorded: number;
  topSpeedKmh: number | null;
  highestPointM: number | null;
  byMotion: { motion: MotionClass; hours: number; km: number }[];
};

const one = (n: number) => Math.round(n * 10) / 10;

export function everydayView(summary: EverydaySummary): TravTrackYearStats {
  const { figures } = summary;
  return {
    kmGround: summary.kmGround > 0 ? one(summary.kmGround) : null,
    daysRecorded: summary.days,
    topSpeedKmh: figures.topSpeed ? Math.round(figures.topSpeed.mps * 3.6) : null,
    highestPointM: figures.highest ? Math.round(figures.highest.m) : null,
    byMotion: (Object.entries(figures.byMotion) as [MotionClass, { ms: number; km: number }][])
      .filter(([, v]) => v.ms > 0)
      .map(([motion, v]) => ({ motion, hours: one(v.ms / 3_600_000), km: one(v.km) })),
  };
}

/** The calendar `year` on the account's profile clock, as instants `[from, to)`. */
export async function yearWindow(userId: string, year: number) {
  const { zone } = await profileZoneOf(userId);
  return {
    fromMs: midnightOf(`${String(year).padStart(4, "0")}-01-01`, zone).getTime(),
    untilMs: midnightOf(`${String(year + 1).padStart(4, "0")}-01-01`, zone).getTime(),
  };
}

export async function travTrackYearStats(
  userId: string,
  year: number
): Promise<TravTrackYearStats | null> {
  if (!(await providerIs(userId, "travtrack"))) return null;
  const summary = await loadEverydaySummary(userId, await yearWindow(userId, year));
  return summary ? everydayView(summary) : null;
}

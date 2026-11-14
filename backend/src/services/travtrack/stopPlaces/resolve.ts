import { AppError } from "../../../middleware/errorHandler";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { deriveDay } from "../dayDerivation";
import { clipStops } from "../legs";
import { daysOf, type LegSpan } from "../legs/setMode";
import type { Stop } from "../legs/types";
import { dayAfter, midnightOf } from "../range";

/**
 * Which stop a stop write means. The client sends exactly the (clipped) span the day
 * view returned for a part of a stay; the server resolves it to the WHOLE stay, derived
 * the very way the day view derives it (`dayDerivation.ts`, one derivation). A name or a
 * dismissal then belongs to the stay, and both days of a night show it.
 */

export const stopNotFound = () =>
  new AppError("No stop under that span", 404, "TRAVTRACK_STOP_NOT_FOUND");

export type ResolvedStays = {
  /** The stay the span lies on (more than half of its clipped part), unclipped; null if none. */
  stay: Stop | null;
  /** Every stay the days around the span show, unclipped, each once. */
  all: Stop[];
  /** The stay's part on the day the span lies in, as the day view returns it. */
  part: Stop | null;
};

export async function resolveStays(userId: string, span: LegSpan): Promise<ResolvedStays> {
  const all = new Map<string, Stop>();
  let part: Stop | null = null;
  let stay: Stop | null = null;
  let share = 0;
  for (const { day, zone } of await daysOf(userId, span)) {
    const window = {
      fromMs: midnightOf(day, zone).getTime(),
      untilMs: midnightOf(dayAfter(day), zone).getTime(),
    };
    const derived = await deriveDay(userId, window);
    for (const w of derived.whole) {
      all.set(`${w.fromMs}-${w.untilMs}`, w);
      // Each stay's own clipped part, so stays that nest (two devices) are never mixed up.
      const [p] = clipStops([w], window);
      const s = p ? overlapShare(p, span) : 0;
      if (s <= 0.5 || s <= share) continue;
      [part, stay, share] = [p, w, s];
    }
  }
  return { stay, all: [...all.values()], part };
}

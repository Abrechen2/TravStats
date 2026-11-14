import { AppError } from "../../../middleware/errorHandler";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { deriveDay } from "../dayDerivation";
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
    const derived = await deriveDay(userId, {
      fromMs: midnightOf(day, zone).getTime(),
      untilMs: midnightOf(dayAfter(day), zone).getTime(),
    });
    for (const w of derived.whole) all.set(`${w.fromMs}-${w.untilMs}`, w);
    for (const p of derived.stops) {
      const s = overlapShare(p, span);
      if (s <= 0.5 || s <= share) continue;
      const whole = derived.whole.find((w) => w.fromMs <= p.fromMs && w.untilMs >= p.untilMs);
      if (!whole) continue;
      [part, stay, share] = [p, whole, s];
    }
  }
  return { stay, all: [...all.values()], part };
}

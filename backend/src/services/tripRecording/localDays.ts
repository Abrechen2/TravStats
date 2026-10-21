import { localDay } from "../../shared/time/instant";
import { offsetMsAt } from "../../shared/time/zonedParts";

/**
 * `localDay` for many instants in one zone — the trip recording's day list
 * and `?day=` filter, read on every map view (forgejo#316). Per point it was
 * one `Intl` reading each: 2.3 s for 300 000 points (found in the review of
 * forgejo#319).
 *
 * Instants are taken in six-hour spans of UTC. Where the zone's offset is
 * the same at both ends of a span, nothing changes inside it but the
 * calendar: local time is the instant plus that offset, so the span holds at
 * most one local midnight, at a computable instant, and every point's day is
 * the day at the span's start or at its end. Four `Intl` readings per span,
 * whatever the points in it. A span whose ends disagree holds a transition
 * and is read point by point, exactly as before. (Two transitions that undo
 * each other within six hours would pass unseen; no zone has ever had them.)
 *
 * Exactly `localDay`'s answer, odd offsets (+05:45, -03:30, +12:45) and
 * transitions at midnight included — `recordingDays.test.ts` compares every
 * point in ten such zones.
 */

const SPAN_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

interface Span {
  /** Null when the offset changes inside the span: read each point. */
  dayBefore: string | null;
  dayFrom: string | null;
  /** The span's local midnight; `Infinity` when there is none inside it. */
  midnightMs: number;
}

/** A function from an instant (epoch ms) to its calendar day in `zone`. Throws as `localDay` does for a zone it refuses. */
export function localDayReader(zone: string): (instantMs: number) => string {
  const spans = new Map<number, Span>();

  const spanAt = (index: number): Span => {
    const cached = spans.get(index);
    if (cached) return cached;
    const start = index * SPAN_MS;
    const end = start + SPAN_MS - 1;
    const first = localDay(new Date(start), zone);
    const offset = offsetMsAt(start, zone);
    let span: Span;
    if (offset === null || offset !== offsetMsAt(end, zone)) {
      span = { dayBefore: null, dayFrom: null, midnightMs: Infinity };
    } else {
      // The first instant whose local reading starts a new day.
      const midnightMs = Math.ceil((start + offset + 1) / DAY_MS) * DAY_MS - offset;
      span =
        midnightMs <= end
          ? { dayBefore: first, dayFrom: localDay(new Date(midnightMs), zone), midnightMs }
          : { dayBefore: first, dayFrom: first, midnightMs: Infinity };
    }
    spans.set(index, span);
    return span;
  };

  return (instantMs: number) => {
    const span = spanAt(Math.floor(instantMs / SPAN_MS));
    if (span.dayBefore === null || span.dayFrom === null)
      return localDay(new Date(instantMs), zone);
    return instantMs < span.midnightMs ? span.dayBefore : span.dayFrom;
  };
}

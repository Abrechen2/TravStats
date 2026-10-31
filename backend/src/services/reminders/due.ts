import { toInstant } from "../../shared/time/instant";

/** A reminder is still sent when it is at most this late (a missed cron run, a short outage). */
export const MAX_LATENESS_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Due when `anchor - lead` has passed, the anchor itself has not, and the
 * reminder is no more than {@link MAX_LATENESS_MS} late. Anything later is
 * skipped: "leaves in 2 hours" sent at 30 minutes would be wrong.
 */
export function isDue(anchor: Date, leadHours: number, now: Date): boolean {
  const dueAt = anchor.getTime() - leadHours * HOUR_MS;
  return (
    anchor.getTime() > now.getTime() &&
    dueAt <= now.getTime() &&
    now.getTime() - dueAt <= MAX_LATENESS_MS
  );
}

/** The anchor range a query must read to find everything due for `leadHours` at `now`. */
export function dueAnchorRange(leadHours: number, now: Date): { start: Date; end: Date } {
  const end = now.getTime() + leadHours * HOUR_MS;
  return { start: new Date(Math.max(end - MAX_LATENESS_MS, now.getTime())), end: new Date(end) };
}

/**
 * A wall-clock time (`YYYY-MM-DD`, `HH:mm`) in an IANA zone as an instant.
 * A time the zone skipped (spring forward) moves to the next valid instant;
 * a repeated time (autumn) is the earlier one. The lead is subtracted from the
 * result in UTC, never on the wall clock.
 */
export function anchorFromLocal(day: string, hhmm: string, zone: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  for (let extra = 0; extra <= 180; extra += 15) {
    const total = h * 60 + m + extra;
    const local = `${day}T${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    try {
      return toInstant(local, zone, { fold: "earlier", origin: "typed" }).utc;
    } catch {
      // Nonexistent local time: try the next quarter hour.
    }
  }
  return toInstant(`${day}T${hhmm}`, zone, { origin: "machine" }).utc;
}

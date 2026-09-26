import { localDay } from "./instant";

/**
 * "Now", asked instead of read (ADR 0002 D6).
 *
 * Code that decides a day or a status — past or planned, "today", a
 * countdown — asks this clock rather than calling `new Date()` or
 * `Date.now()`. An odd host zone in CI catches a bug that depends on the
 * host; it does NOT catch one that only shows up across midnight, because
 * the suite runs at whatever time of day CI happens to start. Pinning the
 * clock to 23:59 and 00:01 in the zone that matters is the test that does.
 */

type NowSource = () => Date;

const systemNow: NowSource = () => new Date();

let source: NowSource = systemNow;

/** The current instant. */
export function now(): Date {
  return source();
}

/** Today's calendar day (`YYYY-MM-DD`) in a zone — the user's profile zone for "today" questions (D4). */
export function todayIn(zone: string): string {
  return localDay(now(), zone);
}

/**
 * Pins the clock for a test: a fixed instant, a function, or null to restore
 * the system clock. Refused outside the test environment — a production path
 * that froze time would turn every status and countdown silently stale.
 */
export function setClockForTests(fixed: Date | string | NowSource | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setClockForTests is only available when NODE_ENV=test");
  }
  if (fixed === null) {
    source = systemNow;
  } else if (typeof fixed === "function") {
    source = fixed;
  } else {
    const pinned = new Date(fixed);
    if (!Number.isFinite(pinned.getTime()))
      throw new Error(`Invalid pinned clock: ${String(fixed)}`);
    source = () => new Date(pinned.getTime());
  }
}

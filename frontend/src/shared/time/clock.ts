/**
 * "Now", injected rather than read (ADR 0002, D6).
 *
 * MIRRORED at backend/src/shared/time — change both together.
 *
 * Code that decides a day or a status asks this clock instead of calling
 * `new Date()` / `Date.now()`, so a test can pin the moment — at 23:59 and
 * 00:01 in the zone that matters — instead of hoping the host's clock and zone
 * happen to expose a midnight bug. An odd host zone alone does not catch a bug
 * that only shows up across midnight.
 */
import { localDay } from "./zone";

type ClockSource = () => Date;

const systemClock: ClockSource = () => new Date();

let source: ClockSource = systemClock;

/** The current instant. */
export function now(): Date {
  return source();
}

/**
 * The calendar day (`YYYY-MM-DD`) it is in `zone` at `at` (default: now).
 * "Today" is always asked in a named zone — the user's profile zone for
 * status and countdowns (Q1) — never in the browser's.
 */
export function todayIn(zone: string, at: Date = now()): string {
  return localDay(at, zone);
}

/**
 * Pin the clock for a test: a fixed instant, a function, or `null` to return
 * to the system clock. Tests must restore it (`afterEach`).
 */
export function setClockForTests(fixed: Date | string | ClockSource | null): void {
  if (fixed === null) {
    source = systemClock;
  } else if (typeof fixed === "function") {
    source = fixed;
  } else {
    const pinned = new Date(fixed);
    source = () => new Date(pinned.getTime());
  }
}

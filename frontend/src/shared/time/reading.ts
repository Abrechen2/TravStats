/**
 * What a screen reads off a `TimeValue` (ADR 0002, D3 "out").
 *
 * WEB-ONLY, display-only. The rule the three functions keep: the place's day
 * and clock come from `local` as the server wrote it — never from `utc` read
 * in the browser's zone — and `utc` is only used for "which came first" and
 * "how long". The viewer's own clock appears in exactly one place, the
 * optional "your time" hint (owner decision Q2), and never replaces `local`.
 */
import { displayParts, type TimeValue } from "./wire";
import { isValidZone, toLocal } from "./zone";

/**
 * The calendar day at the place (`YYYY-MM-DD`) — the key a timeline groups
 * by. Taken from `local`, so a flight that lands on the 1st at the place is
 * on the 1st, whatever day it already was in UTC.
 */
export function dayOf(value: TimeValue): string {
  return value.local.slice(0, 10);
}

/** `HH:mm` at the place, or null when the value does not know its time of day. */
export function clockOf(value: TimeValue): string | null {
  return displayParts(value)?.time ?? null;
}

/**
 * The same instant on the viewer's clock, for the "your time: …" hint — or
 * null when there is nothing to add: a value without a time of day, a viewer
 * zone the runtime does not know, or a viewer who is on the place's clock
 * anyway.
 */
export function viewerReading(
  value: TimeValue,
  viewerZone: string | null | undefined
): { local: string; offset: string } | null {
  if (!viewerZone || !isValidZone(viewerZone)) return null;
  if (clockOf(value) === null) return null;
  const reading = toLocal(value.utc, viewerZone);
  return reading.local.slice(0, 16) === value.local.slice(0, 16) ? null : reading;
}

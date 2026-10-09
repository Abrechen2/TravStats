import type { CruiseStopInput } from "../../types";

let counter = 0;

/** A key for a stop added in the editor — never the same as a loaded one. */
export function newStopKey(): string {
  counter += 1;
  return `new-${counter}`;
}

/**
 * The stop's key, or its position while it has none yet. Read by the editor
 * for the open day and for the ids of a day's controls.
 */
export function stopKeyAt(stop: CruiseStopInput, index: number): string {
  return stop.uiKey ?? `at-${index}`;
}

/**
 * Every stop with a key, the unkeyed ones keyed by their CURRENT position —
 * the same key `stopKeyAt` reported for them, so a day that was open before
 * the first edit is still the open day after it (forgejo#221). Always a new
 * array, so a caller may change it without touching the stops it was given.
 */
export function withStopKeys(stops: readonly CruiseStopInput[]): CruiseStopInput[] {
  if (stops.every((stop) => stop.uiKey !== undefined)) return [...stops];
  return stops.map((stop, index) =>
    stop.uiKey !== undefined ? stop : { ...stop, uiKey: stopKeyAt(stop, index) }
  );
}

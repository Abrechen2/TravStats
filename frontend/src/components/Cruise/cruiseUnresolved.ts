import type { Cruise, CruiseStopInput, Port } from "../../types";

/** How an imported name is compared: trimmed, case-insensitive — as `countUnresolvedPorts`. */
export const normalizePortName = (name: string): string => name.trim().toLowerCase();

/** One imported port name the catalogue could not match, with every day it appears on. */
export interface UnresolvedGroup {
  /** The name as the booking wrote it (first spelling met). */
  name: string;
  key: string;
  days: number[];
}

/**
 * The work list of forgejo#222: each unresolved NAME once, with its days — a
 * round trip that calls at "Colón" twice is one decision, not two. Same
 * grouping as `countUnresolvedPorts`, so the list and the "+2" beside the port
 * count always name the same number.
 */
export function unresolvedGroups(cruise: Pick<Cruise, "stops">): UnresolvedGroup[] {
  const groups = new Map<string, UnresolvedGroup>();
  for (const stop of [...cruise.stops].sort((a, b) => a.dayNumber - b.dayNumber)) {
    if (stop.isAtSea || stop.port?.id != null || !stop.unresolvedPortName) continue;
    const key = normalizePortName(stop.unresolvedPortName);
    const group = groups.get(key);
    if (group) group.days.push(stop.dayNumber);
    else groups.set(key, { name: stop.unresolvedPortName.trim(), key, days: [stop.dayNumber] });
  }
  return [...groups.values()];
}

/**
 * Every stop carrying this unresolved name becomes a call at `port`. Nothing
 * else changes: not the day, not the times, not the note — and never the
 * sea-day flag. An unresolved port is a port the ship DID call at; turning it
 * into a sea day would delete a visit (CLAUDE.md, "Cruise stops").
 */
export function resolveStops(
  stops: readonly CruiseStopInput[],
  key: string,
  port: Port
): CruiseStopInput[] {
  return stops.map((stop) =>
    !stop.isAtSea &&
    stop.portId == null &&
    stop.unresolvedPortName &&
    normalizePortName(stop.unresolvedPortName) === key
      ? { ...stop, portId: port.id, port, unresolvedPortName: null }
      : stop
  );
}

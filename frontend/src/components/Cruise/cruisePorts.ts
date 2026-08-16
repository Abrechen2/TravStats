import type { Cruise, CruiseStop, Port } from "../../types";

/**
 * Shared port-sequence helpers for cruise surfaces.
 *
 * A cruise's "effective" itinerary is departure port → port-call stops →
 * arrival port. Several surfaces (list row, detail header, detail timeline)
 * previously disagreed on what counts as a port — the list counted
 * departure/arrival while the detail page only counted port-call stops, so
 * the same cruise read "4 ports" in one place and "0 ports" in another.
 * Every consumer goes through these helpers now.
 */

/**
 * Unique, identifiable ports across departure / arrival / port-call stops.
 *
 * Unresolved (coordinate-less) stops are deliberately NOT counted here. They
 * are real port *calls*, but their name could not be matched to the catalogue,
 * so they cannot be de-duplicated against a matched port of the same name —
 * counting them would double a port the user visited once. This mirrors the
 * backend's `cruisePortsUnique` (backend/src/utils/cruiseStats.ts), which has
 * always excluded them. Use `countUnresolvedPorts` to show them alongside.
 */
export function countUniquePorts(cruise: Cruise): number {
  const portIds = new Set<number>();
  if (cruise.departurePort?.id != null) portIds.add(cruise.departurePort.id);
  if (cruise.arrivalPort?.id != null) portIds.add(cruise.arrivalPort.id);
  for (const stop of cruise.stops) {
    if (stop.isAtSea) continue;
    if (stop.port?.id != null) portIds.add(stop.port.id);
  }
  return portIds.size;
}

/**
 * Distinct unresolved port names, trimmed and compared case-insensitively.
 * Shown next to `countUniquePorts`, never merged into it — see that function
 * for why.
 */
export function countUnresolvedPorts(cruise: Cruise): number {
  const names = new Set<string>();
  for (const stop of cruise.stops) {
    if (stop.isAtSea || stop.port?.id != null) continue;
    if (stop.unresolvedPortName) {
      names.add(stop.unresolvedPortName.trim().toLowerCase());
    }
  }
  return names.size;
}

/** One entry of the effective itinerary, with whatever timing it carries.
 *  Departure and arrival ports have no stop row, so they borrow the cruise's
 *  own start/end timestamps. */
export interface EffectiveSequenceEntry {
  port: Port;
  dayNumber: number;
  arrivalTime: string | null;
  departureTime: string | null;
}

/**
 * Ordered port-call sequence including departure and arrival ports, carrying
 * each entry's timing (sea days excluded). This is the single source for the
 * itinerary order used by map layers and the globe time slider, so those
 * two cannot drift apart. Mirrors the backend's `buildEffectivePortSequence`
 * (backend/src/shared/cruise/portSequence.ts).
 *
 * NOT the source for the detail timeline — `buildEffectiveTimeline` below
 * still carries its own copy of the departure/arrival dedupe (and, unlike
 * this function, trusts the API's stop order instead of sorting by
 * `dayNumber`), because the timeline needs the raw `stop`/`unresolvedPortName`
 * fields this projection drops.
 *
 * Dedupe rule, same as the backend: departure/arrival are skipped when they
 * equal the first/last port call — parsers often repeat the embark port as
 * day 1.
 */
export function effectiveTimedSequence(cruise: Cruise): EffectiveSequenceEntry[] {
  const seq: EffectiveSequenceEntry[] = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((s) => ({
      port: s.port as Port,
      dayNumber: s.dayNumber,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
    }));

  if (cruise.departurePort && cruise.departurePort.id !== seq[0]?.port.id) {
    seq.unshift({
      port: cruise.departurePort,
      dayNumber: 1,
      arrivalTime: null,
      departureTime: cruise.startDate,
    });
  }
  if (cruise.arrivalPort && cruise.arrivalPort.id !== seq[seq.length - 1]?.port.id) {
    seq.push({
      port: cruise.arrivalPort,
      dayNumber: (seq[seq.length - 1]?.dayNumber ?? 0) + 1,
      arrivalTime: cruise.endDate,
      departureTime: null,
    });
  }
  return seq;
}

/** Ports only, in itinerary order. Thin projection of
 *  `effectiveTimedSequence` so there is exactly one ordering rule. */
export function effectivePortSequence(cruise: Cruise): Port[] {
  return effectiveTimedSequence(cruise).map((e) => e.port);
}

export interface EffectiveTimelineEntry {
  /** Stable key for React lists. */
  key: string;
  /** The stop record when the entry comes from a port-call/sea-day stop. */
  stop: CruiseStop | null;
  /** Resolved port — null for sea days. */
  port: Port | null;
  isAtSea: boolean;
  /** Unresolved port name when this entry is an unresolved stop, else null. */
  unresolvedPortName: string | null;
  /** Best-known date for the entry (ISO string) or null. */
  date: string | null;
  excursionNote: string | null;
}

/**
 * Full itinerary including departure and arrival ports. Departure/arrival
 * entries are skipped when they duplicate the adjacent port-call stop (PDF
 * imports often repeat the embark port as day 1).
 */
export function buildEffectiveTimeline(cruise: Cruise): EffectiveTimelineEntry[] {
  const entries: EffectiveTimelineEntry[] = cruise.stops.map((stop) => ({
    key: stop.id,
    stop,
    port: stop.port ?? null,
    isAtSea: stop.isAtSea,
    unresolvedPortName: stop.unresolvedPortName ?? null,
    // Prefer the explicit per-stop date; fall back to the arrival timestamp for
    // older stops imported before the date field existed.
    date: stop.date ?? stop.arrivalTime ?? null,
    excursionNote: stop.excursionNote ?? null,
  }));

  const firstPortCall = entries.find((e) => !e.isAtSea && e.port !== null);
  const lastPortCall = [...entries].reverse().find((e) => !e.isAtSea && e.port !== null);

  if (cruise.departurePort && cruise.departurePort.id !== firstPortCall?.port?.id) {
    entries.unshift({
      key: `departure-${cruise.departurePort.id}`,
      stop: null,
      port: cruise.departurePort,
      isAtSea: false,
      unresolvedPortName: null,
      date: cruise.startDate,
      excursionNote: null,
    });
  }
  if (cruise.arrivalPort && cruise.arrivalPort.id !== lastPortCall?.port?.id) {
    entries.push({
      key: `arrival-${cruise.arrivalPort.id}`,
      stop: null,
      port: cruise.arrivalPort,
      isAtSea: false,
      unresolvedPortName: null,
      date: cruise.endDate,
      excursionNote: null,
    });
  }

  return entries;
}

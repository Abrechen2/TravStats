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

/** Unique ports across departure / arrival / port-call stops. */
export function countUniquePorts(cruise: Cruise): number {
  const portIds = new Set<number>();
  if (cruise.departurePort?.id != null) portIds.add(cruise.departurePort.id);
  if (cruise.arrivalPort?.id != null) portIds.add(cruise.arrivalPort.id);
  for (const stop of cruise.stops) {
    if (!stop.isAtSea && stop.port?.id != null) portIds.add(stop.port.id);
  }
  return portIds.size;
}

/**
 * Ordered port-call sequence including departure and arrival ports
 * (sea days excluded). This is what map layers pair into legs — it
 * mirrors the backend's `buildEffectivePortSequence`
 * (backend/src/shared/cruise/portSequence.ts).
 */
export function effectivePortSequence(cruise: Cruise): Port[] {
  const seq = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((s) => s.port as Port);
  if (cruise.departurePort && cruise.departurePort.id !== seq[0]?.id) {
    seq.unshift(cruise.departurePort);
  }
  if (cruise.arrivalPort && cruise.arrivalPort.id !== seq[seq.length - 1]?.id) {
    seq.push(cruise.arrivalPort);
  }
  return seq;
}

export interface EffectiveTimelineEntry {
  /** Stable key for React lists. */
  key: string;
  /** The stop record when the entry comes from a port-call/sea-day stop. */
  stop: CruiseStop | null;
  /** Resolved port — null for sea days. */
  port: Port | null;
  isAtSea: boolean;
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
    date: stop.arrivalTime ?? null,
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
      date: cruise.endDate,
      excursionNote: null,
    });
  }

  return entries;
}

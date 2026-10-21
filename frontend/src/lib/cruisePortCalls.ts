import type { Cruise, CruiseStop, Port } from "../types/cruise";

/** One call at a port: the port, when, and the stop behind it (none for an
 *  embarkation or disembarkation port that is not one of the stops). */
export interface CruisePortCall {
  port: Port;
  /** ISO date or instant of the call, when known. */
  date: string | undefined;
  stop: CruiseStop | null;
}

/**
 * A cruise's calls at ports, in order: the departure port, every stop at a
 * port, the arrival port. The departure and arrival ports count only when
 * they are not already the first / last port stop, so a turnaround port is
 * one call, not two.
 *
 * The ONE list the map's port markers and the port card read (forgejo#323):
 * the marker counted an embarkation port that was not a stop while the card
 * it opened counted stops only, and said "0 visits" (Codex review).
 */
export function cruisePortCalls(cruise: Cruise): CruisePortCall[] {
  const portStops = cruise.stops.filter((s) => !s.isAtSea && s.port);
  const first = portStops[0]?.port;
  const last = portStops[portStops.length - 1]?.port;
  const calls: CruisePortCall[] = [];
  if (cruise.departurePort && cruise.departurePort.id !== first?.id) {
    calls.push({ port: cruise.departurePort, date: cruise.startDate ?? undefined, stop: null });
  }
  for (const stop of portStops) {
    calls.push({
      port: stop.port as Port,
      date: stop.arrivalTime ?? stop.departureTime ?? undefined,
      stop,
    });
  }
  if (cruise.arrivalPort && cruise.arrivalPort.id !== last?.id) {
    calls.push({ port: cruise.arrivalPort, date: cruise.endDate ?? undefined, stop: null });
  }
  return calls;
}

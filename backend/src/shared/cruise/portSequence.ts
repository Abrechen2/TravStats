/**
 * Effective port sequence for a cruise itinerary.
 *
 * A cruise's full route is departure port → port-call stops → arrival
 * port. The departure/arrival ports live on the Cruise row itself, not
 * in `cruise_stops`, so any consumer that only walks the stops
 * (legs/distances, geometry, stats) silently drops the first and last
 * leg — a minimal A-to-B cruise with no detailed stop list rendered no
 * route at all. Every backend consumer builds its sequence through this
 * helper now; the frontend mirror is
 * `frontend/src/components/Cruise/cruisePorts.ts`.
 *
 * Dedupe rule: departure/arrival are skipped when they equal the
 * first/last port call (parsers often repeat the embark port as day 1).
 * Ports in the middle are never deduped — visiting the same port twice
 * is a legitimate itinerary.
 */
export function buildEffectivePortSequence<P extends { id: number }>(
  departurePort: P | null | undefined,
  portCalls: P[],
  arrivalPort: P | null | undefined,
): P[] {
  const seq = [...portCalls];
  if (departurePort && departurePort.id !== seq[0]?.id) seq.unshift(departurePort);
  if (arrivalPort && arrivalPort.id !== seq[seq.length - 1]?.id) seq.push(arrivalPort);
  return seq;
}

import type { CruiseStopInput, Port } from "../../types";

/** Longest itinerary spelled out in full; past it, the middle collapses to "…". */
const MAX_NAMED_PORTS = 4;

const SEPARATOR = " → ";

/**
 * A route name built from the ports of the itinerary, in order — "Kiel → Oslo →
 * Kiel" — for the edit form to OFFER, never to write on its own.
 *
 * Sea days name no port and are skipped; an unresolved import keeps the name it
 * came with. A port repeated back-to-back (the departure port that is also the
 * day-1 stop) is one call, not two. Past four ports the middle collapses, so a
 * 14-night itinerary reads "Kiel → Oslo → … → Kiel" rather than a paragraph.
 * Abstains ("") when fewer than two ports remain: one port is not a route.
 */
export function suggestCruiseRouteName(
  departurePort: Pick<Port, "name"> | null,
  stops: readonly CruiseStopInput[],
  arrivalPort: Pick<Port, "name"> | null
): string {
  const names = [
    departurePort?.name,
    ...stops.map((stop) =>
      stop.isAtSea ? undefined : (stop.port?.name ?? stop.unresolvedPortName ?? undefined)
    ),
    arrivalPort?.name,
  ]
    .map((name) => name?.trim() ?? "")
    .filter((name) => name.length > 0)
    .filter((name, i, all) => i === 0 || name !== all[i - 1]);

  if (names.length < 2) return "";
  if (names.length <= MAX_NAMED_PORTS) return names.join(SEPARATOR);
  return [names[0], names[1], "…", names[names.length - 1]].join(SEPARATOR);
}

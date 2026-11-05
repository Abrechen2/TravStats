import type { TripFlightArc } from "./TripMapGlobeLayers";
import type { TripMapContent } from "./tripMapContent";
import { resolveTripFlightColor } from "./tripMapColors";

type FlightColorConfig = Parameters<typeof resolveTripFlightColor>[1];

/** The trip's flights as arcs; a flight missing an end, or sitting at 0/0, has none. */
export function buildTripFlightArcs(
  flights: NonNullable<TripMapContent["flights"]>,
  colorConfig: FlightColorConfig
): TripFlightArc[] {
  const out: TripFlightArc[] = [];
  for (const f of flights) {
    if (
      f.depLat == null ||
      f.depLon == null ||
      f.arrLat == null ||
      f.arrLon == null ||
      (f.depLat === 0 && f.depLon === 0) ||
      (f.arrLat === 0 && f.arrLon === 0)
    ) {
      continue;
    }
    out.push({
      flightId: f.id,
      source: [f.depLon, f.depLat],
      target: [f.arrLon, f.arrLat],
      label: `${f.depIata ?? "?"} → ${f.arrIata ?? "?"}`,
      color: resolveTripFlightColor(f, colorConfig),
    });
  }
  return out;
}

import { ArcLayer } from "@deck.gl/layers";
import type { Flight } from "../../types";

const DEFAULT_COLOR: [number, number, number, number] = [100, 100, 120, 100];

function hexToRgba(hex: string, alpha = 200): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

interface TripRoutesData {
  flight: Flight;
  color: [number, number, number, number];
}

export function createTripRoutesLayer(
  flights: Flight[],
  trips: Array<{ id: string; color: string }>
): ArcLayer<TripRoutesData> {
  const tripColorMap = new Map(trips.map((t) => [t.id, hexToRgba(t.color)]));

  const data: TripRoutesData[] = flights
    .filter(
      (f) =>
        f.depLat != null &&
        f.depLat !== 0 &&
        f.depLon != null &&
        f.depLon !== 0 &&
        f.arrLat != null &&
        f.arrLat !== 0 &&
        f.arrLon != null &&
        f.arrLon !== 0
    )
    .map((f) => ({
      flight: f,
      color: f.tripId ? (tripColorMap.get(f.tripId) ?? DEFAULT_COLOR) : DEFAULT_COLOR,
    }));

  return new ArcLayer<TripRoutesData>({
    id: "trip-routes-layer",
    data,
    getSourcePosition: (d) => [d.flight.depLon!, d.flight.depLat!],
    getTargetPosition: (d) => [d.flight.arrLon!, d.flight.arrLat!],
    getSourceColor: (d) => d.color,
    getTargetColor: (d) => d.color,
    getWidth: 2,
    pickable: true,
  });
}

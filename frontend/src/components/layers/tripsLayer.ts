import { TripsLayer } from "deck.gl";
import type { GeoJSONFeature } from "../../types";
import type { TripDatum } from "./layerTypes";

export function buildTripsData(flights: GeoJSONFeature[]): TripDatum[] {
  return (
    flights
      .filter((f) => {
        const coords = f.geometry.coordinates;
        return coords != null && coords.length >= 2;
      })
      .map((f) => {
        const coords = f.geometry.coordinates;
        const t0 = new Date(f.properties.departureTime).getTime() / 1000;
        const t1 = new Date(f.properties.arrivalTime).getTime() / 1000;
        return {
          path: [coords[0] as [number, number], coords[coords.length - 1] as [number, number]],
          timestamps: [t0, t1],
        };
      })
      // Filter out trips with invalid timestamps so NaN never reaches the TimeSlider (Bug 6)
      .filter((t) => t.timestamps.every((ts) => !isNaN(ts)))
  );
}

export function getTimeRange(trips: TripDatum[]): { min: number; max: number } {
  const all = trips.flatMap((t) => t.timestamps).filter((n) => !isNaN(n));
  if (all.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...all),
    max: Math.max(...all),
  };
}

export function createTripsLayer(trips: TripDatum[], currentTime: number): TripsLayer<TripDatum> {
  return new TripsLayer<TripDatum>({
    id: "trips",
    data: trips,
    getPath: (d) => d.path,
    getTimestamps: (d) => d.timestamps,
    getColor: [255, 255, 255, 200],
    currentTime,
    trailLength: 3600 * 6,
    widthMinPixels: 1.5,
  });
}

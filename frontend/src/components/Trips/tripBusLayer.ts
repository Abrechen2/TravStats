import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { TripBusJourney } from "../../types/bus";

/** `--ts-domain-bus` (#c49a6c) as deck.gl reads a colour: RGB(A) numbers. */
const BUS_RGB: [number, number, number] = [196, 154, 108];

export interface BusPathDatum {
  id: string;
  path: [number, number][];
  /** Whether the line follows the road or is only the chord between the terminals. */
  routed: boolean;
}

/**
 * The line of each bus ride on the trip map (forgejo#180): its frozen road
 * geometry where one was fetched, else the straight chord between the two
 * terminals — drawn thinner and fainter then, so a chord does not pass for the
 * road the coach took. A ride whose terminals have no coordinates is left out.
 */
export function busPaths(rides: readonly TripBusJourney[]): BusPathDatum[] {
  const out: BusPathDatum[] = [];
  for (const ride of rides) {
    const coords = [ride.depLat, ride.depLon, ride.arrLat, ride.arrLon];
    if (coords.some((v) => typeof v !== "number" || !Number.isFinite(v))) continue;
    const routed = Array.isArray(ride.geometry) && ride.geometry.length >= 2;
    out.push({
      id: ride.id,
      path: routed
        ? (ride.geometry as [number, number][])
        : [
            [ride.depLon, ride.depLat],
            [ride.arrLon, ride.arrLat],
          ],
      routed,
    });
  }
  return out;
}

export function buildBusLayers(rides: readonly TripBusJourney[]): Layer[] {
  const data = busPaths(rides);
  if (data.length === 0) return [];
  return [
    new PathLayer<BusPathDatum>({
      id: "trip-bus-rides",
      data,
      getPath: (d) => d.path,
      getColor: (d) => [...BUS_RGB, d.routed ? 230 : 150],
      getWidth: (d) => (d.routed ? 3 : 2),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
    }),
  ];
}

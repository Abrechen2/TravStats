import { groupMapData, pathIdentity } from "../layers/routeAggregation";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { TripBusJourney } from "../../types/bus";
import { hexToRgb } from "../../lib/domainColor";
import { buildStationLabelLayers } from "../layers/stationLabelsLayer";

export interface BusPathDatum {
  id: string;
  memberIds?: string[];
  count?: number;
  path: [number, number][];
  /** Whether the line follows the road or is only the chord between the terminals. */
  routed: boolean;
}

/**
 * What `busPaths` reads of a ride — a bus ride, or a ferry crossing, whose two
 * ports carry the same columns and whose stored line (a hand-drawn one) means
 * the same: drawn where it exists, else the chord.
 */
export interface TerminalRideLine {
  id: string;
  status: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  geometry: [number, number][] | null;
}

/**
 * The line of each bus ride on the trip map (forgejo#180): its frozen road
 * geometry where one was fetched, else the straight chord between the two
 * terminals — drawn thinner and fainter then, so a chord does not pass for the
 * road the coach took. A ride whose terminals have no coordinates is left out.
 */
export function busPaths(rides: readonly TerminalRideLine[]): BusPathDatum[] {
  const out: BusPathDatum[] = [];
  for (const ride of rides) {
    if (ride.status === "cancelled") continue;
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
  return groupMapData(
    out,
    (p) => `${p.routed}:${pathIdentity(p.path)}`,
    (p) => p.id
  );
}

/**
 * `colorHex` is the bus colour from the domain colour store — never a constant
 * here, or a user's own bus colour would show everywhere but the trip map.
 */
/** Every point the bus lines cover, for framing the trip map around them. */
export function busPathPoints(rides: readonly TripBusJourney[]): [number, number][] {
  return busPaths(rides).flatMap((d) => d.path);
}

/**
 * The rides' lines and their terminals' names (forgejo#320). The names follow
 * the "important" reveal the trip map gives its hotels — this map has no label
 * switch of its own — and are thinned by zoom like every other label.
 */
export function buildBusLayers(rides: readonly TripBusJourney[], colorHex: string): Layer[] {
  const data = busPaths(rides);
  if (data.length === 0) return [];
  const color = hexToRgb(colorHex);
  const [r, g, b] = color;
  return [
    new PathLayer<BusPathDatum>({
      id: "trip-bus-rides",
      data,
      getPath: (d) => d.path,
      getColor: (d) => [r, g, b, d.routed ? 230 : 150],
      getWidth: (d) => (d.routed ? 3 : 2),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
    }),
    ...buildStationLabelLayers([{ rides, color }], {
      labelsMode: "important",
      idPrefix: "trip-bus",
    }),
  ];
}

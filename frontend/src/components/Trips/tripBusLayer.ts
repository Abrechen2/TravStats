import { groupMapData, pathIdentity } from "../layers/routeAggregation";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import {
  STATION_DOT_OUTLINE_PX,
  STATION_DOT_OUTLINE_RGBA,
  STATION_DOT_RADIUS_PX,
} from "../layers/markerDotStyle";
import type { Layer } from "@deck.gl/core";
import type { TripBusJourney } from "../../types/bus";
import { hexToRgb } from "../../lib/domainColor";
import { buildStationLabelLayers } from "../layers/stationLabelsLayer";
import { endKey } from "../map/cards/journeys/journeyStats";
import { journeyFromBus } from "../map/cards/journeys/journeyNormalize";
import { withJourneyCards } from "../map/cards/journeys/journeyLayerCards";
import { greatCirclePath } from "../layers/greatCircle";
import { RAIL_PATH_GLOBE_ALTITUDE_M } from "../layers/railPathsLayer";

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
 * A ride's line as the map draws it: as stored on the flat map; on the globe
 * lifted by `altitudeM`, and a chord densified along its great circle first.
 * A two-point chord is a straight segment THROUGH the sphere — its middle sank
 * below the surface and the globe clipped it, leaving a stub at each terminal
 * (København → Hamburg ZOB, beta.23 UAT before 2.7.0-rc.20). Rail does the same
 * (`railPathOf`).
 */
export function terminalRidePath(
  d: BusPathDatum,
  altitudeM: number
): [number, number][] | [number, number, number][] {
  if (altitudeM === 0) return d.path;
  const path =
    d.routed || d.path.length !== 2
      ? d.path
      : (greatCirclePath(d.path[0], d.path[1]).points as [number, number][]);
  return path.map(([lon, lat]) => [lon, lat, altitudeM] as [number, number, number]);
}

export interface TerminalDatum {
  position: [number, number];
}

/** One dot per terminal place (to ~100 m, `endKey`), cancelled rides left out. */
export function terminalPoints(rides: readonly TerminalRideLine[]): TerminalDatum[] {
  const byKey = new Map<string, TerminalDatum>();
  for (const ride of rides) {
    if (ride.status === "cancelled") continue;
    for (const [lon, lat] of [
      [ride.depLon, ride.depLat],
      [ride.arrLon, ride.arrLat],
    ] as const) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const key = endKey({ lat, lon });
      if (!byKey.has(key)) byKey.set(key, { position: [lon, lat] });
    }
  }
  return [...byKey.values()];
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
export function buildBusLayers(
  rides: readonly TripBusJourney[],
  colorHex: string,
  onGlobe = false
): Layer[] {
  const data = busPaths(rides);
  if (data.length === 0) return [];
  const color = hexToRgb(colorHex);
  const [r, g, b] = color;
  // Lifted on the globe like rail, ferry and rental, or the line z-fights with the sphere.
  const altitude = onGlobe ? RAIL_PATH_GLOBE_ALTITUDE_M : 0;
  const lines: Layer[] = [
    new PathLayer<BusPathDatum>({
      id: "trip-bus-rides",
      data,
      getPath: (d) => terminalRidePath(d, altitude),
      getColor: (d) => [r, g, b, d.routed ? 230 : 150],
      getWidth: (d) => (d.routed ? 3 : 2),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
    }),
    new ScatterplotLayer<TerminalDatum>({
      id: "trip-bus-terminals",
      data: terminalPoints(rides),
      getPosition: (d) => (altitude === 0 ? d.position : [d.position[0], d.position[1], altitude]),
      getFillColor: [r, g, b, 255],
      getLineColor: STATION_DOT_OUTLINE_RGBA,
      lineWidthUnits: "pixels",
      getLineWidth: STATION_DOT_OUTLINE_PX,
      stroked: true,
      radiusUnits: "pixels",
      getRadius: STATION_DOT_RADIUS_PX,
      pickable: true,
    }),
  ];
  // The rides and their terminals answer a hover and a click (forgejo#323).
  return [
    ...withJourneyCards(lines, rides.map(journeyFromBus), color),
    ...buildStationLabelLayers([{ rides, color }], {
      labelsMode: "important",
      idPrefix: "trip-bus",
      onGlobe,
    }),
  ];
}

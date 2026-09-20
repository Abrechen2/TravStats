// Globe-mode deck.gl layers for the trip map (`Trips/TripMap.tsx`).
//
// TripMap is the app's THIRD renderer — the trip "Karte" tab and the tour
// editor — and it carries a 🌐/🗺 toggle of its own. That toggle drew an EMPTY
// globe: the flight arcs and every stop label disappeared the moment the
// projection flipped. All three causes were already written down beside the
// dashboard globe, one file away:
//
//   1. `ArcLayer.greatCircle` computes its height in screen space, which
//      collapses to zero under MapLibre's globe projection — the arc is there
//      and invisible (Globe/buildGlobeLayers.ts, the note above
//      `globe-flight-arcs`). A PathLayer through pre-tessellated waypoints
//      with a radial z renders through the normal line pipeline and bows.
//   2. deck.gl 9's billboard TextLayer does not render under globe projection
//      in interleaved mode, so the stop names were gone (Globe/
//      GlobeLabelsOverlay.tsx exists because of exactly that). Labels leave
//      here as data and are drawn by that HTML overlay.
//   3. Without EarthOcclusionExtension the far side of the planet draws
//      through the near side, so a trip that circles the globe reads as a
//      tangle.
//
// So this module builds the trip map's globe stack out of the globe modules
// rather than beside them: the geometry comes from `Globe/arcUtils`, the
// horizon clipping from `Globe/EarthOcclusionExtension`, and the two
// altitudes from `Globe/buildGlobeLayers`. Nothing here is a second copy of
// a number that file already owns. What is NOT shared is `buildGlobeLayers`
// itself — it wants aggregated routes with frequency quartiles, a time-slider
// head flight and four hover handlers, none of which a single trip has.
//
// Layer ids match the mercator stack in TripMap.tsx on purpose: the click
// handler keys on `info.layer.id`, so one fly-to switch serves both
// projections.

import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "../Globe/EarthOcclusionExtension";
import {
  ANTIPODAL_DISTANCE_KM,
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "../Globe/arcUtils";
import { CRUISE_PATH_ALTITUDE_M, MARKER_ALTITUDE_M } from "../Globe/buildGlobeLayers";
import type { PointDatum as GlobePointDatum } from "../Globe/globeLayerTypes";
import type { TourPathDatum } from "../layers/tourPathsLayer";
import type { Lodging } from "../../types/lodging";
import { resolveLodgingColor, type LodgingColorConfig } from "../../lib/lodgingColor";

/** Which projection the trip map is currently drawing in. */
export type TripProjection = "mercator" | "globe";

export interface TripFlightArc {
  flightId: string;
  source: [number, number];
  target: [number, number];
  label: string;
  /** Resolved upstream — see `Trips/tripMapColors.ts`. Never decided here. */
  color: [number, number, number];
}

export interface TripCruisePath {
  cruiseId: string;
  path: [number, number][];
  label: string;
  color: [number, number, number];
}

export interface TripPointDatum {
  position: [number, number];
  label: string;
  color: [number, number, number];
  radiusMeters: number;
  kind: "airport" | "stop" | "lodging";
}

/** Marker radius in PIXELS on the globe. The mercator stack sizes its dots in
 *  metres, which is right on a flat map and wrong on a sphere: a 60 km radius
 *  covers a visible slice of the planet at globe zoom. The dashboard globe
 *  made the same move for the same reason. */
const GLOBE_AIRPORT_RADIUS_PX = 4;
const GLOBE_STOP_RADIUS_PX = 5.5;

const MARKER_ALPHA = 230;
const LINE_ALPHA = 235;
/** Marker outline — the app background, so a dot keeps a rim against both a
 *  bright satellite basemap and a dark one. Same value the mercator stack and
 *  the dashboard globe use for the same job. */
const MARKER_OUTLINE: [number, number, number, number] = [13, 17, 23, 220];
const HIGHLIGHT: [number, number, number, number] = [255, 255, 255, 180];

/**
 * Great-circle waypoints for one flight, with the parabolic altitude profile
 * the dashboard globe uses.
 *
 * Near-antipodal pairs get a flat two-point chord: their great circle is
 * degenerate (infinitely many shortest paths, all through a pole) and
 * tessellating one draws the "ring around the pole" artefact. The threshold is
 * `ANTIPODAL_DISTANCE_KM`, shared rather than restated.
 */
export function tripArcWaypoints(arc: TripFlightArc): [number, number, number][] {
  const distanceKm = calculateDistance(arc.source[1], arc.source[0], arc.target[1], arc.target[0]);
  if (distanceKm >= ANTIPODAL_DISTANCE_KM) {
    return [
      [arc.source[0], arc.source[1], 0],
      [arc.target[0], arc.target[1], 0],
    ];
  }
  return greatCircleWaypoints(
    arc.source,
    arc.target,
    getArcPeakAltitudeMeters(distanceKm),
    getArcSteps(distanceKm, false)
  );
}

/**
 * Trip markers in the shape `GlobeLabelsOverlay` reads.
 *
 * The overlay projects each point with `map.project()` and culls it against
 * the horizon, which is the only way a name renders on this stack at all. A
 * point with no text is dropped rather than drawn as an empty pill.
 */
export function toGlobeLabelPoints(points: readonly TripPointDatum[]): GlobePointDatum[] {
  return points
    .filter((p) => p.label.length > 0)
    .map((p) => ({
      position: p.position,
      size: 1,
      iata: p.label,
      name: p.label,
      label: p.label,
    }));
}

/**
 * The trip's hotels as plain globe markers.
 *
 * The flat map draws them through `buildLodgingPins`, which is right there:
 * it carries the lodging tooltip, the colour the lodging list uses, and a
 * deck.gl TextLayer for the names. Under globe projection that last part
 * renders NOTHING, and the dots have no horizon clipping, so a house on the
 * far side of the planet shows through it. Here they become ordinary occluded
 * markers and their names go to the HTML overlay with everything else's.
 */
export function toGlobeLodgingPoints(
  lodgings: readonly Lodging[],
  colors: LodgingColorConfig
): TripPointDatum[] {
  const out: TripPointDatum[] = [];
  for (const l of lodgings) {
    if (l.lat == null || l.lon == null) continue;
    out.push({
      position: [l.lon, l.lat],
      label: l.name,
      color: resolveLodgingColor(l, colors),
      radiusMeters: 40_000,
      kind: "lodging",
    });
  }
  return out;
}

export interface TripMapGlobeLayersOptions {
  flightArcs: readonly TripFlightArc[];
  cruisePaths: readonly TripCruisePath[];
  tourPaths: readonly TourPathDatum[];
  airportPoints: readonly TripPointDatum[];
  stopPoints: readonly TripPointDatum[];
  lodgingPoints: readonly TripPointDatum[];
  /** One shared instance, as the dashboard globe does — a stable reference
   *  keeps deck.gl from recompiling the shader pipeline on every rebuild. */
  occlusionExt: EarthOcclusionExtension;
  occlusionProps: EarthOcclusionExtensionProps;
}

function markerLayer(
  id: string,
  data: readonly TripPointDatum[],
  radiusPx: number,
  opts: TripMapGlobeLayersOptions
): Layer {
  return new ScatterplotLayer<TripPointDatum>({
    id,
    data: data as TripPointDatum[],
    getPosition: (d) => [d.position[0], d.position[1], MARKER_ALTITUDE_M],
    getFillColor: (d) => [...d.color, MARKER_ALPHA] as [number, number, number, number],
    getRadius: radiusPx,
    radiusUnits: "pixels",
    stroked: true,
    getLineColor: MARKER_OUTLINE,
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 200],
    extensions: [opts.occlusionExt],
    ...opts.occlusionProps,
  } as ConstructorParameters<typeof ScatterplotLayer<TripPointDatum>>[0] &
    EarthOcclusionExtensionProps);
}

/** Lift a surface polyline off the sphere so it does not share depth-buffer
 *  values with the globe mesh — without this a cruise leg or a tour section
 *  flickers in and out of the planet. */
function lift(path: ReadonlyArray<readonly [number, number]>): [number, number, number][] {
  return path.map((p) => [p[0], p[1], CRUISE_PATH_ALTITUDE_M]);
}

export function buildTripMapGlobeLayers(opts: TripMapGlobeLayersOptions): Layer[] {
  const { flightArcs, cruisePaths, tourPaths, airportPoints, stopPoints, lodgingPoints } = opts;

  const arcs = new PathLayer<TripFlightArc>({
    id: "trip-flight-arcs",
    data: flightArcs as TripFlightArc[],
    getPath: tripArcWaypoints,
    getColor: (d) => [...d.color, LINE_ALPHA] as [number, number, number, number],
    getWidth: 2,
    widthUnits: "pixels",
    widthMinPixels: 1.5,
    widthMaxPixels: 4,
    capRounded: true,
    jointRounded: true,
    // `greatCircleWaypoints` emits monotone longitudes that may leave ±180
    // so an antimeridian crossing stays one line. deck.gl's own wrapping
    // would cut it at the seam and draw a phantom line back across the map.
    wrapLongitude: false,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT,
    extensions: [opts.occlusionExt],
    ...opts.occlusionProps,
  } as ConstructorParameters<typeof PathLayer<TripFlightArc>>[0] & EarthOcclusionExtensionProps);

  const cruises = new PathLayer<TripCruisePath>({
    id: "trip-cruise-paths",
    data: cruisePaths as TripCruisePath[],
    getPath: (d) => lift(d.path),
    getColor: (d) => [...d.color, LINE_ALPHA] as [number, number, number, number],
    getWidth: 3,
    widthUnits: "pixels",
    widthMinPixels: 2,
    widthMaxPixels: 5,
    capRounded: true,
    jointRounded: true,
    wrapLongitude: false,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT,
    extensions: [opts.occlusionExt],
    ...opts.occlusionProps,
  } as ConstructorParameters<typeof PathLayer<TripCruisePath>>[0] & EarthOcclusionExtensionProps);

  // A `straight` (unrouted) leg stays thinner and dimmer here exactly as it
  // does on the flat map — that is a claim about the DATA, and it must not
  // change meaning because the projection did.
  const tours = new PathLayer<TourPathDatum>({
    id: "trip-tour-paths",
    data: tourPaths as TourPathDatum[],
    getPath: (d) => lift(d.path),
    getColor: (d) => [...d.color, d.isPlaceholder ? 170 : 255] as [number, number, number, number],
    getWidth: (d) => (d.isPlaceholder ? 2 : 3.5),
    widthUnits: "pixels",
    widthMinPixels: 2,
    capRounded: true,
    jointRounded: true,
    wrapLongitude: false,
    pickable: true,
    autoHighlight: true,
    highlightColor: HIGHLIGHT,
    extensions: [opts.occlusionExt],
    ...opts.occlusionProps,
  } as ConstructorParameters<typeof PathLayer<TourPathDatum>>[0] & EarthOcclusionExtensionProps);

  return [
    cruises,
    arcs,
    tours,
    markerLayer("trip-airports", airportPoints, GLOBE_AIRPORT_RADIUS_PX, opts),
    markerLayer("lodging-pins", lodgingPoints, GLOBE_STOP_RADIUS_PX, opts),
    markerLayer("trip-stops", stopPoints, GLOBE_STOP_RADIUS_PX, opts),
  ];
}

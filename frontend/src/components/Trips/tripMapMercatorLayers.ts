// The flat trip map's own deck.gl layers: flights, cruise legs, tour sections,
// airports, stops and hotels, then the names and numbers that go with them.
// Moved out of `TripMap.tsx` (at the file-size limit) when the day filter, the
// numbering and the direction arrows arrived; the globe's counterpart is
// `TripMapGlobeLayers.ts`, and both read the SAME data (`tripMapData.ts`).

import { groupMapData, pathIdentity } from "../layers/routeAggregation";
import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { buildLodgingPins } from "../layers/lodgingPinsLayer";
import type { TourPathDatum } from "../layers/tourPathsLayer";
import { shareMapLabels } from "../map/labelObstacles";
import type { LodgingColorConfig } from "../../lib/lodgingColor";
import type { Lodging } from "../../types/lodging";
import { type TripCruisePath, type TripFlightArc, type TripPointDatum } from "./TripMapGlobeLayers";
import { TRIP_MAP_CHROME } from "./tripMapColors";
import { buildTripLabelLayers, type TripLabelItem } from "./tripMapLabels";
import { buildArrowLayer, type DirectionLine } from "./tripMapArrows";
import { dayState, dimFirst, emphasisColor, emphasisWidth } from "./tripMapEmphasis";

const MARKER_ALPHA = 230;
const DIM_PIN_OPACITY = 0.25;

export interface MercatorLayerInput {
  flightArcs: readonly TripFlightArc[];
  cruisePaths: readonly TripCruisePath[];
  tourPathData: readonly TourPathDatum[];
  airportPoints: readonly TripPointDatum[];
  stopPoints: readonly TripPointDatum[];
  lodgings: readonly Lodging[];
  /** Houses the day filter leaves faint. */
  dimLodgingIds: ReadonlySet<string>;
  lodgingColors: LodgingColorConfig;
  labelItems: readonly TripLabelItem[];
  /** Lines to put a direction arrow on (hidden groups already removed). */
  directionLines: readonly DirectionLine[];
  zoom: number;
  /** A day is chosen: what is off it is drawn grey and thin, what is on it wide. */
  dayChosen?: boolean;
}

export function buildMercatorTripLayers(input: MercatorLayerInput): Layer[] {
  const { zoom } = input;
  const chosen = input.dayChosen === true;
  const flightArcs = dimFirst(input.flightArcs);
  const cruisePaths = dimFirst(input.cruisePaths);
  const airportPoints = dimFirst(input.airportPoints);
  const stopPoints = dimFirst(input.stopPoints);
  const stateOf = (d: { dim?: boolean }) => dayState(d.dim, chosen);
  const triggers = {
    updateTriggers: { getColor: [chosen], getWidth: [chosen], getRadius: [chosen] },
  };

  const arcs = new ArcLayer<TripFlightArc>({
    id: "trip-flight-arcs",
    data: flightArcs as TripFlightArc[],
    getSourcePosition: (d) => d.source,
    getTargetPosition: (d) => d.target,
    getSourceColor: (d) => emphasisColor(d.color, stateOf(d), 230),
    getTargetColor: (d) => emphasisColor(d.color, stateOf(d), 230),
    getWidth: (d) => emphasisWidth(2, stateOf(d)),
    updateTriggers: {
      getSourceColor: [chosen],
      getTargetColor: [chosen],
      getWidth: [chosen],
    },
    greatCircle: true,
    // Flat. deck.gl's ArcLayer bows every arc up out of the map by default,
    // which reads as depth on a tilted view and as a meaningless bulge on a
    // flat one — and on a short hop the bulge is taller than the route is
    // long. Height 0 lays the great circle on the ground, where the line
    // between two airports actually belongs.
    getHeight: 0,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRIP_MAP_CHROME.highlight,
  });

  const paths = new PathLayer<TripCruisePath>({
    id: "trip-cruise-paths",
    data: groupMapData(
      cruisePaths as TripCruisePath[],
      (p) => JSON.stringify([p.color, pathIdentity(p.path), p.dim === true]),
      (p) => p.cruiseId
    ),
    getPath: (d) => d.path,
    getColor: (d) => emphasisColor(d.color, stateOf(d), 230),
    getWidth: (d) => emphasisWidth(3, stateOf(d)),
    // Pixels, not the PathLayer's default metres: a metre width clamps to the minimum and nothing shows.
    widthUnits: "pixels",
    widthMinPixels: 1,
    ...triggers,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRIP_MAP_CHROME.highlight,
  });

  const airports = new ScatterplotLayer<TripPointDatum>({
    id: "trip-airports",
    data: airportPoints as TripPointDatum[],
    getPosition: (d) => d.position,
    getFillColor: (d) => emphasisColor(d.color, stateOf(d), MARKER_ALPHA),
    getRadius: (d) => d.radiusMeters,
    radiusMinPixels: 4,
    radiusMaxPixels: 8,
    ...triggers,
    stroked: true,
    getLineColor: TRIP_MAP_CHROME.outline,
    lineWidthMinPixels: 1,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRIP_MAP_CHROME.highlightStrong,
  });

  // Tour route sections, coloured per LEG mode, never the section's — a road
  // tour with one ferry crossing must still show that leg as a ferry line. An
  // unrouted (`isPlaceholder`) leg is thinner and fainter, but MUST stay
  // visible: measured against this dark basemap, alpha 70 at 1.5px drew zero
  // pixels. Do not lower these again; 170/2px is the floor.
  const tourPaths = new PathLayer<TourPathDatum>({
    id: "trip-tour-paths",
    data: input.tourPathData as TourPathDatum[],
    getPath: (d) => d.path,
    getColor: (d) => emphasisColor(d.color, stateOf(d), d.isPlaceholder ? 170 : 255),
    getWidth: (d) => emphasisWidth(d.isPlaceholder ? 2 : 3.5, stateOf(d)),
    widthUnits: "pixels",
    widthMinPixels: 1,
    ...triggers,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRIP_MAP_CHROME.highlight,
  });

  const stops = new ScatterplotLayer<TripPointDatum>({
    id: "trip-stops",
    data: stopPoints as TripPointDatum[],
    getPosition: (d) => d.position,
    getFillColor: (d) => emphasisColor(d.color, stateOf(d), MARKER_ALPHA),
    getRadius: (d) => d.radiusMeters,
    radiusMinPixels: 6,
    radiusMaxPixels: 12,
    ...triggers,
    stroked: true,
    getLineColor: TRIP_MAP_CHROME.outline,
    lineWidthMinPixels: 1.5,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRIP_MAP_CHROME.highlightStrong,
  });

  // The trip's hotels, through the layer the main map draws them with. A house
  // the day filter leaves faint is built on its own (no names) and dimmed as a
  // layer, because the pin layer resolves its colour from the house, not from
  // an alpha we could hand it per dot.
  const { dimLodgingIds, lodgings } = input;
  const live = lodgings.filter((l) => !dimLodgingIds.has(l.id));
  const faint = lodgings.filter((l) => dimLodgingIds.has(l.id));
  const lodgingPins = [
    ...(buildLodgingPins(live, 1, zoom, {
      labelsMode: "important",
      // Without this the pins fall back to the DEFAULT lodging config, so a
      // user who switched hotels to "by rating" saw it everywhere but here.
      colors: input.lodgingColors,
    }) ?? []),
    ...(
      buildLodgingPins(faint, 1, zoom, { labelsMode: "off", colors: input.lodgingColors }) ?? []
    ).map((layer) =>
      layer.clone({ id: `${layer.id}-dim`, opacity: DIM_PIN_OPACITY } as Parameters<
        Layer["clone"]
      >[0])
    ),
  ];

  const arrows = buildArrowLayer(input.directionLines);
  const labels = buildTripLabelLayers(input.labelItems, zoom, chosen);
  const own = [
    paths,
    arcs,
    airports,
    tourPaths,
    stops,
    ...lodgingPins,
    ...(arrows ? [arrows] : []),
    labels.names,
  ];
  // One label pass, as on the main map. The numbers join after it: see `buildTripLabelLayers`.
  return [
    ...shareMapLabels(own, "important", Math.round(zoom)),
    ...(labels.numbers ? [labels.numbers] : []),
  ];
}

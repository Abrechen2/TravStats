// Factory for the deck.gl layer stack rendered by GlobeView.
// Extracted from the inline `useMemo` body so the React component shell
// stays focused on state + UI and the layer construction can be read
// (and reasoned about) on its own.
//
// All inputs are explicit — no closures over component state. The
// caller wraps this in `useMemo` and supplies the same dependency list
// it would have used inline; nothing in here depends on render scope.

import { ColumnLayer, PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./EarthOcclusionExtension";
import { escapeHtml } from "../../lib/escapeHtml";
import type { Quartile } from "./heatmapUtils";
import type {
  ArcDatum,
  CruisePathDatum,
  GlobePinned,
  PointDatum,
  TooltipState,
} from "./globeLayerTypes";

const CRUISE_PATH_COLOR: [number, number, number, number] = [80, 180, 255, 230];
const AIRPORT_DOT_COLOR: [number, number, number, number] = [251, 191, 36, 230];
const PORT_DOT_COLOR: [number, number, number, number] = [56, 189, 248, 230];

// Airport + port column markers. Height and radius are constant so all
// markers look identical regardless of visit count — magnitude encoding
// belongs on the arcs (heatmap colour), not duplicated on the dots.
const MARKER_HEIGHT_M = 70_000;
const MARKER_RADIUS_M = 12_000;

export interface BuildGlobeLayersOptions {
  arcsData: ArcDatum[];
  antipodalArcs: ArcDatum[];
  cruisePaths: CruisePathDatum[];
  airportPoints: PointDatum[];
  portPoints: PointDatum[];
  shipMarkerPoints: PointDatum[];
  headFlightArc: ArcDatum | null;
  activeQuartile: Quartile | null;
  lite: boolean;
  shipMarkers: boolean;
  occlusionExt: EarthOcclusionExtension;
  occlusionProps: EarthOcclusionExtensionProps;
  onArcHover: (info: PickingInfo<ArcDatum>) => void;
  onAirportHover: (info: PickingInfo<PointDatum>) => void;
  onPortHover: (info: PickingInfo<PointDatum>) => void;
  onCruisePathHover: (info: PickingInfo<CruisePathDatum>) => void;
  flyToArc: (arc: ArcDatum) => void;
  setPinned: (pinned: GlobePinned | null) => void;
  setTooltip: (tooltip: TooltipState | null) => void;
}

export function buildGlobeLayers(opts: BuildGlobeLayersOptions): Layer[] {
  const {
    arcsData,
    antipodalArcs,
    cruisePaths,
    airportPoints,
    portPoints,
    shipMarkerPoints,
    headFlightArc,
    activeQuartile,
    lite,
    shipMarkers,
    occlusionExt,
    occlusionProps,
    onArcHover,
    onAirportHover,
    onPortHover,
    onCruisePathHover,
    flyToArc,
    setPinned,
    setTooltip,
  } = opts;

  return [
    // Flight arcs as PathLayer with pre-tessellated great-circle
    // waypoints. ArcLayer.greatCircle is broken on globe projection
    // (height computed in screen-space → invisible) — explicit
    // waypoints sidestep the issue and the curve looks identical.
    // Dash extension renders metadata-weak arcs (aggregated without
    // an IATA match) as dashed; strong arcs get [0,0] which the
    // extension treats as solid. EarthOcclusionExtension provides
    // per-fragment horizon clipping in the GPU.
    new PathLayer<ArcDatum>({
      id: "globe-flight-arcs",
      data: arcsData,
      getPath: (d) => d.waypoints,
      getColor: (d) => {
        const baseAlpha =
          activeQuartile === null || activeQuartile === d.quartile ? 235 : 35;
        return [...d.color, baseAlpha] as [number, number, number, number];
      },
      updateTriggers: { getColor: [activeQuartile] },
      getWidth: (d) => Math.max(1.5, Math.min(4, 1.5 + Math.log2(d.count + 1))),
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      widthMaxPixels: 4,
      capRounded: true,
      jointRounded: true,
      // Waypoints are pre-unwrapped (lng can exceed ±180 to stay
      // monotone across the antimeridian). PathLayer's own wrapping
      // would cut them at ±180 and create the phantom-ring artifact.
      wrapLongitude: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 180],
      onHover: onArcHover,
      onClick: ({ object }: { object?: ArcDatum }): void => {
        if (!object) return;
        setPinned({ kind: "arc", data: object });
        flyToArc(object);
      },
      extensions: [
        new PathStyleExtension({ dash: true, highPrecisionDash: true }),
        occlusionExt,
      ],
      getDashArray: (d: ArcDatum) => (d.weak ? [4, 3] : [0, 0]),
      dashJustified: true,
      dashGapPickable: false,
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] &
      PathStyleExtensionProps<ArcDatum> &
      EarthOcclusionExtensionProps),
    // Antipodal routes (>= ANTIPODAL_DISTANCE_KM) — flat surface
    // line at altitude 0, narrower than normal arcs and slightly
    // muted, so the route still appears visually but doesn't grab
    // the eye like a real arc would. Counter shown in the legend.
    new PathLayer<ArcDatum>({
      id: "globe-flight-arcs-antipodal",
      data: antipodalArcs,
      getPath: (d) => d.waypoints,
      getColor: (d) => {
        const baseAlpha =
          activeQuartile === null || activeQuartile === d.quartile ? 160 : 25;
        return [...d.color, baseAlpha] as [number, number, number, number];
      },
      updateTriggers: { getColor: [activeQuartile] },
      getWidth: 1,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 1.5,
      capRounded: true,
      jointRounded: true,
      wrapLongitude: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 180],
      onHover: onArcHover,
      onClick: ({ object }: { object?: ArcDatum }): void => {
        if (object) setPinned({ kind: "arc", data: object });
      },
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] & EarthOcclusionExtensionProps),
    // Cruise paths render as a dashed "wake" — a long stroke + short
    // gap pattern visually distinguishes ship routes from the solid
    // flight arcs without needing a different colour. PathStyleExtension
    // ships its own shader; high-precision dashes work in globe
    // projection without the dash length scaling weirdly with zoom.
    // Cast: PathStyleExtension augments PathLayer props at runtime,
    // but @deck.gl/extensions doesn't merge those keys into PathLayer's
    // TS surface. Cast the whole config so the dash props reach the
    // constructor while keeping the rest literal-checked.
    new PathLayer<CruisePathDatum>({
      id: "globe-cruise-paths",
      data: cruisePaths,
      getPath: (d) => d.path,
      getColor: CRUISE_PATH_COLOR,
      getWidth: 2,
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      widthMaxPixels: 3,
      capRounded: true,
      jointRounded: true,
      extensions: [
        new PathStyleExtension({ dash: true, highPrecisionDash: true }),
        occlusionExt,
      ],
      getDashArray: [6, 3],
      dashJustified: true,
      dashGapPickable: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 180],
      onHover: onCruisePathHover,
      onClick: ({ object }: { object?: CruisePathDatum }): void => {
        if (object) setPinned({ kind: "cruise", data: object });
      },
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<CruisePathDatum>>[0] &
      PathStyleExtensionProps<CruisePathDatum> &
      EarthOcclusionExtensionProps),
    // Airport + port markers as ColumnLayer (3D cylinders rendered
    // radially outward from the globe surface). Replaces the old
    // ScatterplotLayer dots that clipped into the sphere when viewed
    // from a low pitch — same visual idiom react-globe.gl used. Size
    // is intentionally constant (height + radius identical for every
    // marker): visit count is already encoded by the heatmap colour
    // on the arcs, so dual-encoding it here makes hub clusters
    // visually overwhelming without adding information.
    new ColumnLayer<PointDatum>({
      id: "globe-airport-columns",
      data: airportPoints,
      getPosition: (d) => d.position,
      getFillColor: AIRPORT_DOT_COLOR,
      getElevation: MARKER_HEIGHT_M,
      elevationScale: 1,
      radius: MARKER_RADIUS_M,
      diskResolution: lite ? 8 : 16,
      extruded: true,
      material: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 200],
      onHover: onAirportHover,
      onClick: ({ object }: { object?: PointDatum }): void => {
        if (object) setPinned({ kind: "airport", data: object });
      },
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] & EarthOcclusionExtensionProps),
    new ColumnLayer<PointDatum>({
      id: "globe-port-columns",
      data: portPoints,
      getPosition: (d) => d.position,
      getFillColor: PORT_DOT_COLOR,
      getElevation: MARKER_HEIGHT_M,
      elevationScale: 1,
      radius: MARKER_RADIUS_M,
      diskResolution: lite ? 8 : 16,
      extruded: true,
      material: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 200],
      onHover: onPortHover,
      onClick: ({ object }: { object?: PointDatum }): void => {
        if (object) setPinned({ kind: "port", data: object });
      },
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] & EarthOcclusionExtensionProps),
    // Live-mode "head" highlight: bright orange overlay on the most
    // recent flight in the live window. Drawn AFTER everything else so
    // it visually pops above the heatmap. Pickable so the user can
    // still click it.
    ...(headFlightArc
      ? [
          new PathLayer<ArcDatum>({
            id: "globe-flight-head",
            data: [headFlightArc],
            getPath: (d) => d.waypoints,
            getColor: [...headFlightArc.color, 245] as [number, number, number, number],
            getWidth: 5,
            widthUnits: "pixels",
            widthMinPixels: 4,
            widthMaxPixels: 6,
            capRounded: true,
            jointRounded: true,
            wrapLongitude: false,
            pickable: true,
            autoHighlight: !lite,
            highlightColor: [255, 255, 255, 220],
            onHover: onArcHover,
            onClick: ({ object }: { object?: ArcDatum }) => {
              if (object) setPinned({ kind: "arc", data: object });
            },
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] &
            EarthOcclusionExtensionProps),
          // Head endpoint dot — column at the arrival airport of the
          // most-recent flight, so the eye lands on "where the trail
          // ends right now".
          new ColumnLayer<PointDatum>({
            id: "globe-flight-head-marker",
            data: [
              {
                position: headFlightArc.to,
                size: 1,
                iata: headFlightArc.arrival.iata ?? "",
                name: headFlightArc.arrival.name ?? "",
              },
            ],
            getPosition: (d) => d.position,
            getFillColor: [240, 169, 71, 235],
            getElevation: MARKER_HEIGHT_M * 1.6,
            elevationScale: 1,
            radius: MARKER_RADIUS_M * 0.85,
            diskResolution: lite ? 8 : 16,
            extruded: true,
            material: false,
            pickable: false,
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] &
            EarthOcclusionExtensionProps),
        ]
      : []),
    // Ship markers: taller, narrower columns at each visible cruise's
    // current position. Only present when the toggle is on.
    ...(shipMarkers && shipMarkerPoints.length > 0
      ? [
          new ColumnLayer<PointDatum>({
            id: "globe-ship-columns",
            data: shipMarkerPoints,
            getPosition: (d) => d.position,
            getFillColor: [125, 211, 252, 235],
            getElevation: MARKER_HEIGHT_M * 2.5,
            elevationScale: 1,
            radius: MARKER_RADIUS_M * 0.55,
            diskResolution: lite ? 6 : 12,
            extruded: true,
            material: false,
            pickable: true,
            autoHighlight: !lite,
            highlightColor: [255, 255, 255, 200],
            onHover: (info: PickingInfo<PointDatum>) => {
              if (info.object && info.x != null && info.y != null) {
                setTooltip({
                  html: `<div style="font-weight:600;">🚢 ${escapeHtml(info.object.name)}</div>`,
                  x: info.x,
                  y: info.y,
                });
              } else {
                setTooltip(null);
              }
            },
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] &
            EarthOcclusionExtensionProps),
        ]
      : []),
  ];
}

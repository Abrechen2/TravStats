// Factory for the deck.gl layer stack rendered by GlobeView.
// Extracted from the inline `useMemo` body so the React component shell
// stays focused on state + UI and the layer construction can be read
// (and reasoned about) on its own.
//
// All inputs are explicit — no closures over component state. The
// caller wraps this in `useMemo` and supplies the same dependency list
// it would have used inline; nothing in here depends on render scope.

import {
  ColumnLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
} from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./EarthOcclusionExtension";
import type { NightCell } from "./sunPosition";
import type { Quartile } from "./heatmapUtils";
import type {
  ArcDatum,
  CruisePathDatum,
  GlobePinned,
  PointDatum,
} from "./globeLayerTypes";

// Default cruise-route colour — the canonical cruise-domain blue
// (BRAND.md §3, --domain-cruise = rgb(111,160,214)). Matches the port
// marker default + the flat-map cruise arcs so ship routes read the same
// on the globe and the 2D map. Alpha is applied at the layer.
export const DEFAULT_CRUISE_ROUTE_COLOR: [number, number, number] = [111, 160, 214];
const CRUISE_PATH_ALPHA = 230;

// Default marker appearance — exported so GlobeView can seed the user
// customisation state from the same source of truth. Airports + ports
// are pixel-sized via ScatterplotLayer so they stay a constant
// on-screen size regardless of zoom (the ColumnLayer variant ballooned
// to city-covering pillars at high zoom).
export const DEFAULT_AIRPORT_COLOR: [number, number, number] = [251, 191, 36];
// Brand cruise blue (BRAND.md §3, --domain-cruise) — same default as the
// flat-map port markers + cruise routes so ports read identically on both
// maps. Was sky-400 [56,189,248], a different blue outside the palette.
export const DEFAULT_PORT_COLOR: [number, number, number] = [111, 160, 214];
export const DEFAULT_MARKER_RADIUS_PX = 5;
// Head-flight arrival marker keeps a little 3-D pop via ColumnLayer,
// but airports + ports go flat. The numbers below are only used by
// the head-flight column.
const HEAD_MARKER_HEIGHT_M = 90_000;
const HEAD_MARKER_RADIUS_M = 10_000;

// Lift cruise paths a few km off the sphere surface so they don't
// z-fight with / clip into the globe. The path geometry comes from the
// backend as 2-D `[lng, lat]` (sea-route GeoJSON); without an altitude
// component, deck.gl renders it at exactly altitude 0 which shares
// depth-buffer values with the sphere mesh and produces the clipping
// the user observed. 5 km is invisible at any user-relevant zoom but
// safely above the precision noise of the fragment depth.
const CRUISE_PATH_ALTITUDE_M = 5_000;
// Night-shade cells sit above the sphere so the globe mesh's depth buffer
// occludes the far side directly (no per-frame occlusion-extension lag).
//
// The altitude has to clear the CHORD SAG of each flat quad, not just be
// "a little" above the surface. A 2.5° cell rendered as a flat polygon has
// its 4 corners on the sphere but its interior chords under it: the cell
// centroid dips ~R·(1/cos(1.77°) − 1) ≈ 3 km below the corner radius. At a
// 1.5 km lift the centroid therefore sank ~1.5 km INTO the sphere and got
// depth-clipped, punching a hole in the middle of every cell — the mottled
// "Flecken" across the night side. Lifting to 10 km keeps the whole cell
// (centroid included) clearly above the sphere, so the shade reads as a
// smooth wash. 10 km is < 0.2 % of Earth's radius — invisible at globe zoom.
const NIGHT_SHADE_ALTITUDE_M = 10_000;
// Airport + port markers (and their labels) lift slightly above the
// cruise-path altitude so they render ON TOP of cruise paths rather
// than getting visually clipped where a path intersects the marker.
// Beta.22 had markers at altitude 0 → cruise paths drew over them at
// shallow camera angles. 8 km is well above the 5 km cruise altitude
// but still hugs the surface visually.
const MARKER_ALTITUDE_M = 8_000;

// Convert a deck.gl PickingInfo.coordinate into a [lng, lat] pair so we
// can anchor the popup where the user actually clicked the line. The
// coordinate is `number[]` of length ≥ 2 in deck.gl's typing — pull
// the first two numbers. Falls back to the path's midpoint if the
// pick didn't carry a coordinate, which can happen for offscreen
// picks or when the pipeline doesn't compute one.
function pickingCoordToLngLat(
  coordinate: number[] | undefined,
  fallbackPath: ReadonlyArray<readonly number[]>,
): [number, number] {
  if (coordinate && coordinate.length >= 2) {
    return [coordinate[0], coordinate[1]];
  }
  const mid = fallbackPath[Math.floor(fallbackPath.length / 2)];
  if (mid && mid.length >= 2) return [mid[0], mid[1]];
  return [0, 0];
}

export interface BuildGlobeLayersOptions {
  arcsData: ArcDatum[];
  antipodalArcs: ArcDatum[];
  cruisePaths: CruisePathDatum[];
  airportPoints: PointDatum[];
  portPoints: PointDatum[];
  headFlightArc: ArcDatum | null;
  activeQuartile: Quartile | null;
  lite: boolean;
  occlusionExt: EarthOcclusionExtension;
  occlusionProps: EarthOcclusionExtensionProps;
  onArcHover: (info: PickingInfo<ArcDatum>) => void;
  onAirportHover: (info: PickingInfo<PointDatum>) => void;
  onPortHover: (info: PickingInfo<PointDatum>) => void;
  onCruisePathHover: (info: PickingInfo<CruisePathDatum>) => void;
  /** @deprecated retained for source compat; click no longer flies the camera. */
  flyToArc?: (arc: ArcDatum) => void;
  setPinned: (pinned: GlobePinned | null) => void;
  /**
   * When set, every flight arc renders in this RGB instead of the
   * heatmap palette derived from per-route quartile. The quartile
   * dimming (active filter) is preserved as alpha so the filter still
   * works visually. Same prop semantics as `MapContainer3D.flightRouteColor`
   * on the flat map.
   */
  flightRouteColor?: [number, number, number];
  /** User multiplier on flight-arc line width (1 = default). */
  arcWidthScale: number;
  /** Cruise-route colour (RGB); alpha applied internally. */
  cruiseRouteColor: [number, number, number];
  /** User multiplier on cruise-path line width (1 = default). */
  cruiseArcWidthScale: number;
  /** Airport marker fill colour (RGB); alpha is applied internally. */
  airportColor: [number, number, number];
  /** Cruise-port marker fill colour (RGB); alpha applied internally. */
  portColor: [number, number, number];
  /** Airport marker radius in pixels. */
  airportRadius: number;
  /** Cruise-port marker radius in pixels. */
  portRadius: number;
  /** Fine night-side grid cells (from the day/night terminator). */
  nightCells: NightCell[];
  /** Toggle the day/night shade overlay. */
  showNight: boolean;
}

export function buildGlobeLayers(opts: BuildGlobeLayersOptions): Layer[] {
  const {
    arcsData,
    antipodalArcs,
    cruisePaths,
    airportPoints,
    portPoints,
    headFlightArc,
    activeQuartile,
    lite,
    occlusionExt,
    occlusionProps,
    onArcHover,
    onAirportHover,
    onPortHover,
    onCruisePathHover,
    setPinned,
    flightRouteColor,
    arcWidthScale,
    cruiseRouteColor,
    cruiseArcWidthScale,
    airportColor,
    portColor,
    airportRadius,
    portRadius,
    nightCells,
    showNight,
  } = opts;
  // Pick the per-arc colour. With `flightRouteColor` set, every arc
  // gets that single tint; otherwise the per-arc quartile heatmap
  // applies. Active-quartile alpha dimming is preserved either way so
  // the click-to-isolate filter still reads visually.
  const arcColor = (d: ArcDatum, baseAlpha: number): [number, number, number, number] => {
    const rgb = flightRouteColor ?? d.color;
    return [rgb[0], rgb[1], rgb[2], baseAlpha];
  };

  return [
    // Day/night shade — a fine grid of small quads over the night
    // hemisphere, alpha ramped from the terminator inward (soft
    // twilight band). Rendered first so flight arcs / markers draw on
    // top. Lifted to NIGHT_SHADE_ALTITUDE_M and depth-tested (NOT
    // `depthCompare: "always"`) so the globe mesh occludes far-side cells
    // via the shared depth buffer with zero frame lag.
    //
    // NO EarthOcclusionExtension here (deliberately). The extension does a
    // per-fragment horizon fade using a camera uniform that lags one frame
    // behind MapLibre's during rotation — on this altitude-lifted shade
    // that lag flashed the terminator/limb cells on every move (the
    // residual "night overlay flicker" after the globe-mesh fix). The
    // shared depth buffer already hides the far side instantly, so the
    // extension is redundant; dropping it kills the flicker. The layer's
    // own `d.shade` alpha ramp still gives the soft twilight band.
    // `depthWriteEnabled: false` keeps the shade from occluding the arcs /
    // markers drawn after it.
    new SolidPolygonLayer<NightCell>({
      id: "globe-night-shade",
      data: nightCells,
      visible: showNight,
      getPolygon: (d) =>
        d.polygon.map((p) => [p[0], p[1], NIGHT_SHADE_ALTITUDE_M] as [number, number, number]),
      filled: true,
      getFillColor: (d) => [8, 14, 34, Math.round(d.shade * 150)],
      parameters: { depthWriteEnabled: false, cullMode: "none" },
      pickable: false,
      updateTriggers: { getFillColor: [nightCells] },
    }),
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
      getColor: (d) =>
        arcColor(d, activeQuartile === null || activeQuartile === d.quartile ? 235 : 35),
      // Match the flat-map routes-layer formula so flight-arc thickness
      // is consistent across map ↔ globe transitions: sqrt(count) px,
      // 1 flight → 1 px, 16 flights → 4 px (cap), then the user width
      // multiplier. The earlier log2-based curve started at 2.5 px which
      // read as too heavy on the globe.
      getWidth: (d) => Math.min(Math.sqrt(d.count), 4) * arcWidthScale,
      updateTriggers: {
        getColor: [activeQuartile, flightRouteColor],
        getWidth: [arcWidthScale],
      },
      widthUnits: "pixels",
      widthMinPixels: 1 * arcWidthScale,
      widthMaxPixels: 4 * arcWidthScale,
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
      onClick: (info: PickingInfo<ArcDatum>): void => {
        const object = info.object;
        if (!object) return;
        const anchor = pickingCoordToLngLat(info.coordinate, object.waypoints);
        setPinned({ kind: "arc", data: object, anchorLngLat: anchor });
        // No flyToArc here. The popup is now anchored to the click
        // coordinate, so flying the camera away from where the user
        // tapped is anti-pattern, and stacking a 1.5 s flyTo on top of
        // the popup mount + globe re-render was crashing the canvas
        // in some camera states (regression observed on beta.15).
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
      getColor: (d) =>
        arcColor(d, activeQuartile === null || activeQuartile === d.quartile ? 160 : 25),
      updateTriggers: { getColor: [activeQuartile, flightRouteColor] },
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
      onClick: (info: PickingInfo<ArcDatum>): void => {
        const object = info.object;
        if (!object) return;
        const anchor = pickingCoordToLngLat(info.coordinate, object.waypoints);
        setPinned({ kind: "arc", data: object, anchorLngLat: anchor });
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
      // Lift each [lng, lat] point to [lng, lat, alt] so the line
      // renders just above the sphere instead of through it.
      getPath: (d) =>
        d.path.map(
          (p) => [p[0], p[1], CRUISE_PATH_ALTITUDE_M] as [number, number, number],
        ),
      getColor: [
        cruiseRouteColor[0],
        cruiseRouteColor[1],
        cruiseRouteColor[2],
        CRUISE_PATH_ALPHA,
      ],
      // Base 2 px (matches the flat-map cruiseArcsLayer default — visually
      // heavier than a single-flight arc so cruise routes read distinct)
      // times the user's cruise-width multiplier.
      getWidth: () => 2 * cruiseArcWidthScale,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 3 * cruiseArcWidthScale,
      capRounded: true,
      jointRounded: true,
      updateTriggers: {
        getColor: [cruiseRouteColor],
        getWidth: [cruiseArcWidthScale],
      },
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
      onClick: (info: PickingInfo<CruisePathDatum>): void => {
        const object = info.object;
        if (!object) return;
        const anchor = pickingCoordToLngLat(info.coordinate, object.path);
        setPinned({ kind: "cruise", data: object, anchorLngLat: anchor });
      },
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<CruisePathDatum>>[0] &
      PathStyleExtensionProps<CruisePathDatum> &
      EarthOcclusionExtensionProps),
    // Airport + port markers as ScatterplotLayer with `radiusUnits:
    // "pixels"` so they keep a constant on-screen size at all zoom
    // levels. Earlier ColumnLayer extruded cylinders ballooned at
    // high zoom (radius in meters → city-covering pillars). Visit
    // count is encoded by the heatmap colour on the arcs, so the
    // markers don't need to vary in size to convey magnitude.
    new ScatterplotLayer<PointDatum>({
      id: "globe-airport-dots",
      data: airportPoints,
      getPosition: (d) => [d.position[0], d.position[1], MARKER_ALTITUDE_M],
      getFillColor: [airportColor[0], airportColor[1], airportColor[2], 230],
      getRadius: airportRadius,
      updateTriggers: { getFillColor: [airportColor], getRadius: [airportRadius] },
      radiusUnits: "pixels",
      stroked: true,
      getLineColor: [13, 17, 23, 220],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 200],
      onHover: onAirportHover,
      onClick: ({ object }: { object?: PointDatum }): void => {
        if (!object) return;
        setPinned({
          kind: "airport",
          data: object,
          anchorLngLat: [object.position[0], object.position[1]],
        });
      },
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof ScatterplotLayer<PointDatum>>[0] & EarthOcclusionExtensionProps),
    new ScatterplotLayer<PointDatum>({
      id: "globe-port-dots",
      data: portPoints,
      getPosition: (d) => [d.position[0], d.position[1], MARKER_ALTITUDE_M],
      getFillColor: [portColor[0], portColor[1], portColor[2], 230],
      getRadius: portRadius,
      updateTriggers: { getFillColor: [portColor], getRadius: [portRadius] },
      radiusUnits: "pixels",
      stroked: true,
      getLineColor: [13, 17, 23, 220],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 200],
      onHover: onPortHover,
      onClick: ({ object }: { object?: PointDatum }): void => {
        if (!object) return;
        setPinned({
          kind: "port",
          data: object,
          anchorLngLat: [object.position[0], object.position[1]],
        });
      },
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof ScatterplotLayer<PointDatum>>[0] & EarthOcclusionExtensionProps),
    // NOTE: IATA / UN-LOCODE labels are intentionally NOT a deck.gl
    // TextLayer here. deck.gl 9's billboard TextLayer/IconLayer does not
    // render under MapLibre's globe projection in interleaved mode (the
    // identical layer renders fine on the flat mercator map). Labels are
    // drawn instead as an HTML overlay — see `GlobeLabelsOverlay`, which
    // projects each marker to screen space with the same front-face cull
    // as the pinned card.
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
            getColor: arcColor(headFlightArc, 245),
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
            onClick: (info: PickingInfo<ArcDatum>) => {
              const object = info.object;
              if (!object) return;
              const anchor = pickingCoordToLngLat(info.coordinate, object.waypoints);
              setPinned({ kind: "arc", data: object, anchorLngLat: anchor });
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
            getElevation: HEAD_MARKER_HEIGHT_M,
            elevationScale: 1,
            radius: HEAD_MARKER_RADIUS_M,
            radiusUnits: "pixels",
            diskResolution: lite ? 8 : 16,
            extruded: false,
            material: false,
            pickable: false,
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] &
            EarthOcclusionExtensionProps),
        ]
      : []),
  ];
}

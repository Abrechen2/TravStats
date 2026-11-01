// The globe's ground layers as native MapLibre sources + layers (forgejo#331).
//
// Everything that lies on the ground — airport, port, lodging and place dots,
// cruise paths, the night shade and the caller's rail / bus / ferry / tour /
// track lines — is a `circle` / `line` / `fill` layer on the globe projection,
// so it sits ON the surface: no altitude, nothing floating, nothing to
// z-fight. deck.gl keeps only the flight arcs (buildGlobeLayers.ts).
//
// Pure: GeoJSON and layer specs in, nothing touching a map. Colours are
// resolved here through the SAME functions the flat map and the legend call
// (`resolveLodgingColor`, `resolvePlaceColor`, the pre-resolved cruise hue), so
// a dot cannot be one colour on the sphere and another in the legend.

import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { Layer } from "@deck.gl/core";
import { groupMapData, pathIdentity } from "../../layers/routeAggregation";
import { resolveLodgingColor, type LodgingColorConfig } from "../../../lib/lodgingColor";
import { resolvePlaceColor, type PlaceColorConfig } from "../../../lib/placeColor";
import type { Rgb } from "../../../lib/cruiseColor";
import { routeDomainOfLayerId, type RoutesVisible } from "../../../lib/mapRoutes";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import type { NightCell } from "../sunPosition";
import type { CruisePathDatum, PointDatum } from "../globeLayerTypes";
import { resolveCruisePathColor } from "../cruisePathColor";
import { bridgeExtraLayers, type BridgedExtra } from "./nativeExtras";
import { cssRgba, lineFeatures, pointFeature, type NativeFeature } from "./nativeGeo";

export const NATIVE_IDS = {
  night: "globe-night-shade",
  cruise: "globe-cruise-paths",
  airports: "globe-airport-dots",
  ports: "globe-port-dots",
  lodgings: "globe-lodging-pins",
  places: "globe-place-pins",
} as const;

/** Dot outline, the same near-black the deck.gl dots had. */
const DOT_OUTLINE = "rgba(13,17,23,0.86)";
const HOVER_WHITE = "rgba(255,255,255,0.85)";
const CRUISE_DASH: number[] = [6, 3];
const EXTRA_DASH: number[] = [3, 2];
/** Night shade: deck drew `shade * 150` of 255 alpha. */
const NIGHT_MAX_OPACITY = 150 / 255;

export type NativeHitKind = "airport" | "port" | "cruise" | "lodging" | "place" | "extra";

/** What a feature of a native layer stands for — resolved by the feature's `i`. */
export interface NativeHitTarget {
  kind: NativeHitKind;
  /** The id deck.gl called this layer — the tooltip renderer keys on it. */
  deckId: string;
  data: readonly unknown[];
  extra?: BridgedExtra;
}

export interface NativeGlobeInput {
  nightCells: readonly NightCell[];
  showNight: boolean;
  cruisePaths: readonly CruisePathDatum[];
  cruiseWidthScale: number;
  airportPoints: readonly PointDatum[];
  airportColor: Rgb;
  airportRadius: number;
  portPoints: readonly PointDatum[];
  portColor: Rgb;
  portRadius: number;
  lodgings: readonly Lodging[];
  lodgingColors: LodgingColorConfig;
  lodgingRadius: number;
  places: readonly Place[];
  placeColors: PlaceColorConfig;
  placeListColors?: ReadonlyMap<string, Rgb>;
  placeRadius: number;
  extraLayers: readonly Layer[];
  routesVisible: RoutesVisible;
  /** Lite mode: no hover highlight. */
  lite: boolean;
}

/**
 * One-slot memo per source. The hook owns one; without it every rebuild (a
 * marker-size slider, a hover-colour change) would re-tessellate every
 * source's GeoJSON and hand MapLibre a new object to re-upload. Pure when
 * omitted — a miss just recomputes.
 */
export class NativeBuildCache {
  private readonly slots = new Map<string, { deps: readonly unknown[]; value: unknown }>();
  get<T>(key: string, deps: readonly unknown[], make: () => T): T {
    const hit = this.slots.get(key);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i])))
      return hit.value as T;
    const value = make();
    this.slots.set(key, { deps, value });
    return value;
  }
}

export interface NativeGlobeSpec {
  /** Source id → data. A source id is also the id of its (solid) layer. */
  sources: Record<string, FeatureCollection>;
  /** Bottom to top. */
  layers: LayerSpecification[];
  /** Map layer id → what its features are. Only layers a pointer can land on. */
  targets: Map<string, NativeHitTarget>;
  /** Extra layers that could not go native; the caller keeps drawing them with deck.gl. */
  remainingExtras: Layer[];
  /** Hit-test order: dots before lines, top-most first. */
  hitOrder: string[];
}

const hoverGuard = (lite: boolean, normal: ExpressionSpecification | string, hover: string) =>
  lite
    ? normal
    : ([
        "case",
        ["boolean", ["feature-state", "hover"], false],
        hover,
        normal,
      ] as ExpressionSpecification);

const colorOf = (prop: string): ExpressionSpecification => ["to-color", ["get", prop]];

function circleLayer(
  id: string,
  paint: {
    color: ExpressionSpecification | string;
    radius: ExpressionSpecification | number;
    stroke: ExpressionSpecification | string;
    strokeWidth: ExpressionSpecification | number;
  },
  lite: boolean,
  opacity = 1
): LayerSpecification {
  return {
    id,
    type: "circle",
    source: id,
    paint: {
      "circle-color": hoverGuard(lite, paint.color, HOVER_WHITE),
      "circle-radius": paint.radius,
      "circle-stroke-color": paint.stroke,
      "circle-stroke-width": paint.strokeWidth,
      "circle-opacity": opacity,
      "circle-stroke-opacity": opacity,
      // Screen-sized dots that stay put as the camera pitches, like the deck.gl pixel radius did.
      "circle-pitch-scale": "viewport",
      "circle-pitch-alignment": "viewport",
    },
  } as LayerSpecification;
}

function lineLayer(
  id: string,
  source: string,
  width: ExpressionSpecification | number,
  dash: number[] | null,
  filter: ExpressionSpecification | null,
  lite: boolean,
  opacity = 1
): LayerSpecification {
  return {
    id,
    type: "line",
    source,
    ...(filter ? { filter } : {}),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": hoverGuard(lite, colorOf("c"), HOVER_WHITE),
      "line-width": width,
      "line-opacity": opacity,
      ...(dash ? { "line-dasharray": dash } : {}),
    },
  } as LayerSpecification;
}

const collection = (features: NativeFeature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function pointCollection(points: readonly { position: [number, number] }[]): FeatureCollection {
  return collection(points.map((d, i) => pointFeature(d.position, { i }, i + 1)));
}

function cruiseCollection(paths: readonly CruisePathDatum[]): {
  fc: FeatureCollection;
  data: CruisePathDatum[];
} {
  // Same grouping the deck layer applied: identical legs of one cruise draw once.
  const data = groupMapData(
    paths,
    (p) => JSON.stringify([p.color, p.status === "scheduled", pathIdentity(p.path)]),
    (p) => p.cruiseId
  );
  const features: NativeFeature[] = [];
  let nextId = 1;
  data.forEach((d, i) => {
    const made = lineFeatures(d.path, { i, c: cssRgba(resolveCruisePathColor(d)) }, nextId);
    nextId = made.nextId;
    features.push(...made.features);
  });
  return { fc: collection(features), data };
}

function nightCollection(cells: readonly NightCell[]): FeatureCollection {
  return collection(
    cells.map((cell, i) => ({
      type: "Feature" as const,
      id: i + 1,
      properties: { shade: cell.shade },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[...cell.polygon, cell.polygon[0]]],
      },
    }))
  );
}

const hasCoords = (l: Lodging): boolean =>
  l.lat !== null && l.lon !== null && Number.isFinite(l.lat) && Number.isFinite(l.lon);

export function buildNativeGlobe(
  input: NativeGlobeInput,
  cache: NativeBuildCache = new NativeBuildCache()
): NativeGlobeSpec {
  const { lite, routesVisible } = input;
  const sources: Record<string, FeatureCollection> = {};
  const layers: LayerSpecification[] = [];
  const targets = new Map<string, NativeHitTarget>();
  const lineIds: string[] = [];
  const dotIds: string[] = [];

  // Night shade — a ground polygon, so a `fill` layer. No outline: the cells
  // tile, and an antialiased edge would draw a seam between every pair.
  if (input.showNight && input.nightCells.length > 0) {
    sources[NATIVE_IDS.night] = cache.get("night", [input.nightCells], () =>
      nightCollection(input.nightCells)
    );
    layers.push({
      id: NATIVE_IDS.night,
      type: "fill",
      source: NATIVE_IDS.night,
      paint: {
        "fill-color": "rgb(8,14,34)",
        "fill-opacity": ["*", ["get", "shade"], NIGHT_MAX_OPACITY],
        "fill-antialias": false,
      },
    } as LayerSpecification);
  }

  const { bridged, remaining } = cache.get("extras", [input.extraLayers, routesVisible], () =>
    bridgeExtraLayers(
      input.extraLayers.filter((l) => {
        const domain = typeof l?.id === "string" ? routeDomainOfLayerId(l.id) : null;
        return domain === null || routesVisible[domain];
      })
    )
  );

  // Lines first, so every dot draws over them.
  for (const extra of bridged.filter((b) => b.kind === "line")) {
    sources[extra.id] = extra.fc;
    const width: ExpressionSpecification = ["get", "w"];
    layers.push(
      lineLayer(extra.id, extra.id, width, null, ["!=", ["get", "d"], 1], lite, extra.opacity),
      lineLayer(
        `${extra.id}-dashed`,
        extra.id,
        width,
        EXTRA_DASH,
        ["==", ["get", "d"], 1],
        lite,
        extra.opacity
      )
    );
    if (extra.pickable) {
      for (const id of [extra.id, `${extra.id}-dashed`]) {
        targets.set(id, { kind: "extra", deckId: extra.id, data: extra.data, extra });
        lineIds.push(id);
      }
    }
  }

  if (routesVisible.cruise && input.cruisePaths.length > 0) {
    const { fc, data } = cache.get("cruise", [input.cruisePaths], () =>
      cruiseCollection(input.cruisePaths)
    );
    sources[NATIVE_IDS.cruise] = fc;
    // 2 px base (heavier than a single flight, as on the flat map) times the user's width multiplier.
    const width = 2 * input.cruiseWidthScale;
    layers.push(lineLayer(NATIVE_IDS.cruise, NATIVE_IDS.cruise, width, CRUISE_DASH, null, lite));
    targets.set(NATIVE_IDS.cruise, { kind: "cruise", deckId: NATIVE_IDS.cruise, data });
    lineIds.push(NATIVE_IDS.cruise);
  }

  for (const extra of bridged.filter((b) => b.kind === "point")) {
    sources[extra.id] = extra.fc;
    layers.push(
      circleLayer(
        extra.id,
        {
          color: colorOf("f"),
          radius: ["get", "r"],
          stroke: colorOf("s"),
          strokeWidth: ["get", "sw"],
        },
        lite,
        extra.opacity
      )
    );
    if (extra.pickable) {
      targets.set(extra.id, { kind: "extra", deckId: extra.id, data: extra.data, extra });
      dotIds.push(extra.id);
    }
  }

  const dots: {
    id: string;
    kind: NativeHitKind;
    data: readonly unknown[];
    fc: FeatureCollection;
    paint: Parameters<typeof circleLayer>[1];
  }[] = [];
  if (input.airportRadius > 0 && input.airportPoints.length > 0)
    dots.push({
      id: NATIVE_IDS.airports,
      kind: "airport",
      data: input.airportPoints,
      fc: cache.get("airports", [input.airportPoints], () => pointCollection(input.airportPoints)),
      paint: {
        color: cssRgba(input.airportColor, 230),
        radius: input.airportRadius,
        stroke: DOT_OUTLINE,
        strokeWidth: 1,
      },
    });
  if (input.portRadius > 0 && input.portPoints.length > 0)
    dots.push({
      id: NATIVE_IDS.ports,
      kind: "port",
      data: input.portPoints,
      fc: cache.get("ports", [input.portPoints], () => pointCollection(input.portPoints)),
      paint: {
        color: cssRgba(input.portColor, 230),
        radius: input.portRadius,
        stroke: DOT_OUTLINE,
        strokeWidth: 1,
      },
    });
  const lodgingPins = cache.get("lodgingPins", [input.lodgings], () =>
    input.lodgings.filter(hasCoords)
  );
  if (input.lodgingRadius > 0 && lodgingPins.length > 0)
    dots.push({
      id: NATIVE_IDS.lodgings,
      kind: "lodging",
      data: lodgingPins,
      fc: cache.get(
        "lodgings",
        [lodgingPins, input.lodgingColors.mode, input.lodgingColors.colors],
        () =>
          collection(
            lodgingPins.map((d, i) =>
              pointFeature(
                [d.lon as number, d.lat as number],
                { i, f: cssRgba([...resolveLodgingColor(d, input.lodgingColors), 230]) },
                i + 1
              )
            )
          )
      ),
      paint: {
        color: colorOf("f"),
        radius: input.lodgingRadius,
        stroke: DOT_OUTLINE,
        strokeWidth: 1,
      },
    });
  const placePins = cache.get("placePins", [input.places], () =>
    input.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  );
  if (input.placeRadius > 0 && placePins.length > 0)
    dots.push({
      id: NATIVE_IDS.places,
      kind: "place",
      data: placePins,
      // A wishlist place is hollow: transparent fill, coloured ring (placePinsLayer.ts has the why).
      fc: cache.get(
        "places",
        [placePins, input.placeColors.mode, input.placeColors.colors, input.placeListColors],
        () =>
          collection(
            placePins.map((d, i) => {
              const rgb = resolvePlaceColor(
                { visited: d.visited, listColor: input.placeListColors?.get(d.id) },
                input.placeColors
              );
              return pointFeature(
                [d.lon, d.lat],
                {
                  i,
                  f: d.visited ? cssRgba([...rgb, 230]) : "rgba(0,0,0,0)",
                  s: d.visited ? DOT_OUTLINE : cssRgba([...rgb, 235]),
                  sw: d.visited ? 1 : 2,
                },
                i + 1
              );
            })
          )
      ),
      paint: {
        color: colorOf("f"),
        radius: input.placeRadius,
        stroke: colorOf("s"),
        strokeWidth: ["get", "sw"],
      },
    });
  for (const dot of dots) {
    sources[dot.id] = dot.fc;
    layers.push(circleLayer(dot.id, dot.paint, lite));
    targets.set(dot.id, { kind: dot.kind, deckId: dot.id, data: dot.data });
    dotIds.push(dot.id);
  }

  return {
    sources,
    layers,
    targets,
    remainingExtras: remaining,
    hitOrder: [...dotIds.reverse(), ...lineIds.reverse()],
  };
}

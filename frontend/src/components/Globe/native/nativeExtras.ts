// Bridges the caller's own deck.gl layers (`extraLayers` — rail, bus, ferry,
// tour, roadtrip, rental and TravTrack lines and their station dots) onto
// native MapLibre layers, so they sit on the surface like everything else
// that lies on the ground (forgejo#331).
//
// Only the two shapes that carry the ground data are bridged — a plain
// PathLayer and a plain ScatterplotLayer, with pixel units. Everything else
// (a HeatmapLayer, a GeoJsonLayer, TripsLayer, an IconLayer, the station label
// layer, anything in metres) goes back to the caller untouched and stays on
// deck.gl with its occlusion extension. Accessors are evaluated here, once per
// datum, with deck.gl's own calling convention, so a builder keeps writing
// `getColor: (d) => …` and need not know which engine draws it.

import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";
import type { FeatureCollection } from "geojson";
import { logger } from "../../../lib/logger";
import { cssRgba, lineFeatures, pointFeature, type LngLat, type NativeFeature } from "./nativeGeo";

export interface BridgedExtra {
  /** The deck.gl layer id — kept as the MapLibre layer id, so the tooltip and route-visibility rules that key on it still apply. */
  id: string;
  kind: "line" | "point";
  fc: FeatureCollection;
  /** The caller's data, indexed by each feature's `i`. */
  data: readonly unknown[];
  layer: Layer;
  /** Whether a hover or click can land on it. */
  pickable: boolean;
  /** Layer-wide opacity (deck's `opacity` prop). */
  opacity: number;
  /** feature key (`k`) → the caller's datum. A key names its bridge, so a feature still on screen from the previous data cannot resolve to another datum. */
  byKey: ReadonlyMap<string, unknown>;
}

let bridgeCounter = 0;

type Accessor = unknown;
const NO_TARGET: number[] = [];

function read(accessor: Accessor, d: unknown, index: number, data: readonly unknown[]): unknown {
  return typeof accessor === "function"
    ? (accessor as (d: unknown, info: unknown) => unknown)(d, { index, data, target: NO_TARGET })
    : accessor;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isColor = (v: unknown): v is readonly number[] =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(isNumber);
const isLngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length >= 2 && isNumber(v[0]) && isNumber(v[1]);

function dataArray(layer: Layer): readonly unknown[] | null {
  const data = layer.props.data as unknown;
  return Array.isArray(data) ? data : null;
}

function bridgePath(layer: Layer, data: readonly unknown[]): BridgedExtra | null {
  const token = ++bridgeCounter;
  const p = layer.props as unknown as Record<string, Accessor>;
  if (p.widthUnits !== "pixels") return null;
  const dashed = (layer.props.extensions as unknown[] | undefined)?.some(
    (e) => e instanceof PathStyleExtension
  );
  const minPx = isNumber(p.widthMinPixels) ? p.widthMinPixels : 0;
  const maxPx = isNumber(p.widthMaxPixels) ? p.widthMaxPixels : Infinity;
  const features: NativeFeature[] = [];
  let nextId = 1;
  data.forEach((d, i) => {
    const path = read(p.getPath, d, i, data);
    if (!Array.isArray(path)) return;
    const color = read(p.getColor, d, i, data);
    const width = read(p.getWidth, d, i, data);
    const dash = dashed ? read(p.getDashArray, d, i, data) : null;
    const made = lineFeatures(
      path.filter(isLngLat) as LngLat[],
      {
        i,
        k: `${token}:${i}`,
        c: cssRgba(isColor(color) ? color : [0, 0, 0, 255]),
        w: Math.min(maxPx, Math.max(minPx, isNumber(width) ? width : 1)),
        d: Array.isArray(dash) && dash[0] > 0 && dash[1] > 0 ? 1 : 0,
      },
      nextId
    );
    nextId = made.nextId;
    features.push(...made.features);
  });
  return finish(layer, "line", data, features, token);
}

function bridgePoints(layer: Layer, data: readonly unknown[]): BridgedExtra | null {
  const token = ++bridgeCounter;
  const p = layer.props as unknown as Record<string, Accessor>;
  if (p.radiusUnits !== "pixels") return null;
  const features: NativeFeature[] = [];
  data.forEach((d, i) => {
    const position = read(p.getPosition, d, i, data);
    if (!isLngLat(position)) return;
    const fill = read(p.getFillColor, d, i, data);
    const stroke = read(p.getLineColor, d, i, data);
    const radius = read(p.getRadius, d, i, data);
    const strokeWidth = read(p.getLineWidth, d, i, data);
    features.push(
      pointFeature(
        position,
        {
          i,
          k: `${token}:${i}`,
          f: p.filled === false ? "rgba(0,0,0,0)" : cssRgba(isColor(fill) ? fill : [0, 0, 0, 255]),
          s: cssRgba(isColor(stroke) ? stroke : [0, 0, 0, 255]),
          sw: p.stroked && isNumber(strokeWidth) ? strokeWidth : 0,
          r: isNumber(radius) ? radius : 1,
        },
        i + 1
      )
    );
  });
  return finish(layer, "point", data, features, token);
}

function finish(
  layer: Layer,
  kind: BridgedExtra["kind"],
  data: readonly unknown[],
  features: NativeFeature[],
  token: number
): BridgedExtra {
  const byKey = new Map<string, unknown>();
  data.forEach((d, i) => byKey.set(`${token}:${i}`, d));
  return {
    byKey,
    id: layer.id,
    kind,
    fc: { type: "FeatureCollection", features },
    data,
    layer,
    pickable: Boolean(layer.props.pickable),
    opacity: isNumber(layer.props.opacity) ? layer.props.opacity : 1,
  };
}

/** Which layers go native, which stay on deck.gl. A layer hidden by the caller is dropped. */
export function bridgeExtraLayers(layers: readonly Layer[]): {
  bridged: BridgedExtra[];
  remaining: Layer[];
} {
  const bridged: BridgedExtra[] = [];
  const remaining: Layer[] = [];
  for (const layer of layers) {
    if (typeof layer?.clone !== "function" || !layer.props) {
      remaining.push(layer);
      continue;
    }
    const data = dataArray(layer);
    let made: BridgedExtra | null = null;
    try {
      if (data && layer.props.visible !== false) {
        if (layer.constructor === PathLayer) made = bridgePath(layer, data);
        else if (layer.constructor === ScatterplotLayer) made = bridgePoints(layer, data);
      }
    } catch (err) {
      // A builder whose accessor throws would have thrown inside deck.gl; here
      // the layer falls back to deck.gl instead of vanishing.
      logger.warn("GlobeView: could not draw extra layer natively", layer.id, err);
      made = null;
    }
    if (made) bridged.push(made);
    else if (!(data && layer.props.visible === false && isBridgeable(layer))) remaining.push(layer);
  }
  return { bridged, remaining };
}

function isBridgeable(layer: Layer): boolean {
  return layer.constructor === PathLayer || layer.constructor === ScatterplotLayer;
}

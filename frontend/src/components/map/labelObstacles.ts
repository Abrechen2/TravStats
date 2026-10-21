import type { Layer } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import {
  estimateLabelBox,
  projectToWorldPx,
  spreadByBoxes,
  type LabelsMode,
  type PlacedLabel,
} from "./labelPriority";
import { StationLabelsLayer } from "../layers/stationLabelsLayer";

/**
 * The labels the map already shows, as obstacles for the station names
 * (forgejo#320, owner UAT on the overview map).
 *
 * The airport, cruise-port, hotel and place label layers are built inside
 * `DeckGLMap`, each spacing out its own names; the rail/bus/ferry station
 * names are built by the dashboard tabs and arrive as `extraLayers`. Two
 * passes that never saw each other printed "Berlin Ostkreuz" over "BER". The
 * map now reads what its own text layers actually show — after their budget
 * and spacing — and hands that to the station layer, whose pass places
 * around them. Read from the layers rather than recomputed, so the obstacles
 * cannot drift from what is drawn, and a label layer added later is covered
 * the day it is added.
 */

type Accessor<D, V> = V | ((d: D) => V);

const read = <D, V>(a: Accessor<D, V> | undefined, d: D, fallback: V): V =>
  typeof a === "function" ? (a as (d: D) => V)(d) : (a ?? fallback);

interface TextLayerLike<D> {
  data: unknown;
  visible?: boolean;
  getPosition?: Accessor<D, readonly [number, number]>;
  getText?: Accessor<D, string>;
  getSize?: Accessor<D, number>;
  getPixelOffset?: Accessor<D, readonly [number, number]>;
  background?: boolean;
  backgroundPadding?: readonly number[];
}

/** One label a text layer shows, read through the layer's own accessors. */
interface ShownLabel extends PlacedLabel {
  datum: unknown;
  /** The layer's own pixel offset for this label. */
  offset: readonly [number, number];
}

/** Every label one text layer shows, or `null` for any other layer. */
function shownLabels(layer: Layer): ShownLabel[] | null {
  if (!(layer instanceof TextLayer)) return null;
  const props = layer.props as unknown as TextLayerLike<unknown>;
  if (props.visible === false || !Array.isArray(props.data)) return null;
  const padding: [number, number] = props.background
    ? [props.backgroundPadding?.[0] ?? 0, props.backgroundPadding?.[1] ?? 0]
    : [0, 0];
  const out: ShownLabel[] = [];
  for (const d of props.data as unknown[]) {
    const position = read(props.getPosition, d, null as unknown as readonly [number, number]);
    const text = read(props.getText, d, "");
    if (!position || !text) continue;
    const { width, height } = estimateLabelBox(String(text), read(props.getSize, d, 32), padding);
    const offset = read(props.getPixelOffset, d, [0, 0] as readonly [number, number]);
    out.push({ datum: d, position, width, height, offsetY: offset[1] ?? 0, offset });
  }
  return out;
}

/** Every label the given layers show, with its box. */
export function labelObstaclesOf(layers: readonly Layer[]): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const layer of layers) {
    for (const { position, width, height, offsetY, offset } of shownLabels(layer) ?? []) {
      out.push(
        offset[0]
          ? { position, width, height, offsetY, offsetX: offset[0] }
          : { position, width, height, offsetY }
      );
    }
  }
  return out;
}

/**
 * How much each of the map's own label layers weighs a label — the same count
 * its own budget spends first (airport flights, port visits, hotel stays,
 * place visits). A layer not named here weighs every label 0.
 */
const LABEL_WEIGHT: Record<string, string> = {
  "routes-labels": "count",
  "cruise-ports-labels": "visits",
  "lodging-pins-labels": "stayCount",
  "place-pins-labels": "visitCount",
};

const weightOf = (layerId: string, d: unknown): number => {
  const field = LABEL_WEIGHT[layerId];
  const v = field && d && typeof d === "object" ? (d as Record<string, unknown>)[field] : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/** `snapLabelZoom` rounds, so one snapped zoom covers half a step either side. */
const ZOOM_BUCKET_HALF = 0.5;

/**
 * The map's own labels — airport codes, cruise ports, hotels and places — in
 * ONE collision pass (beta.22 UAT). Each layer spaces only its own names (and
 * not at all in "all"), so "HAM", a hotel and a place in Hamburg, or "Hotel
 * Cochem" and "Reichsburg Cochem", printed over each other. Here every label
 * places by weight. In "all" one that would touch another moves beside its
 * dot (`spreadByBoxes`) and waits for the next zoom step only where no spot
 * is free; in "important" (`hideOnly`) it is hidden, as station names are.
 * Run at the map's snapped zoom, i.e. once per zoom step, never per pan;
 * measured at both ends of that step.
 */
function shareOwnLabels(layers: readonly Layer[], zoom: number, hideOnly: boolean): Layer[] {
  type Entry = ShownLabel & { layer: number; weight: number };
  const entries: Entry[] = [];
  const labelled = new Set<number>();
  layers.forEach((layer, i) => {
    const labels = shownLabels(layer);
    if (!labels) return;
    labelled.add(i);
    for (const label of labels) {
      entries.push(Object.assign(label, { layer: i, weight: weightOf(layer.id, label.datum) }));
    }
  });
  if (entries.length === 0) return [...layers];
  const placed = spreadByBoxes(
    entries,
    (e) => e.weight,
    (e) => e.position,
    (e) => e,
    zoom,
    {
      offsetYOf: (e) => e.offsetY,
      project: (p) => projectToWorldPx(p[0], p[1], zoom - ZOOM_BUCKET_HALF),
      bucketScale: 2 ** (2 * ZOOM_BUCKET_HALF),
      hideOnly,
    }
  );
  const byLayer = new Map<number, { data: unknown[]; offsets: Map<unknown, [number, number]> }>();
  for (const { item, shift } of placed) {
    let kept = byLayer.get(item.layer);
    if (!kept) {
      kept = { data: [], offsets: new Map() };
      byLayer.set(item.layer, kept);
    }
    kept.data.push(item.datum);
    kept.offsets.set(item.datum, [item.offset[0] + shift[0], item.offset[1] + shift[1]]);
  }
  return layers.map((layer, i) => {
    if (!labelled.has(i)) return layer;
    const kept = byLayer.get(i) ?? { data: [], offsets: new Map() };
    return (layer as TextLayer<unknown>).clone({
      data: kept.data,
      getPixelOffset: (d: unknown) => kept.offsets.get(d) ?? [0, 0],
    }) as Layer;
  });
}

/**
 * `extraLayers` with every station label layer told about `mapLayers`'
 * labels. Any other layer is passed through untouched, and without a station
 * layer the very same array comes back.
 */
export function withLabelObstacles(extraLayers: Layer[], mapLayers: readonly Layer[]): Layer[] {
  if (!extraLayers.some((l) => l instanceof StationLabelsLayer)) return extraLayers;
  const obstacles = labelObstaclesOf(mapLayers);
  return extraLayers.map((l) =>
    l instanceof StationLabelsLayer ? (l.clone({ obstacles }) as Layer) : l
  );
}

/**
 * The map's own layers, then its extra layers placed around their labels.
 * The own labels first share one collision pass (`shareOwnLabels`); `zoom` is
 * the map's snapped label zoom.
 */
export function appendWithLabelObstacles(
  own: Layer[],
  extraLayers: Layer[],
  labels?: { labelsMode: LabelsMode; zoom: number }
): Layer[] {
  const shown =
    !labels || labels.labelsMode === "off"
      ? own
      : shareOwnLabels(own, labels.zoom, labels.labelsMode === "important");
  return [...shown, ...withLabelObstacles(extraLayers, shown)];
}

/**
 * A map's own layers, then its extra layers: station labels placed around
 * the own labels on a flat map; on the globe, where deck.gl text renders
 * nothing, only carrying their names to the HTML label overlay.
 */
export function withStationLabels(
  own: Layer[],
  extraLayers: readonly Layer[] | undefined,
  onGlobe: boolean
): Layer[] {
  if (!extraLayers) return own;
  if (!onGlobe) return appendWithLabelObstacles(own, [...extraLayers]);
  return [
    ...own,
    ...extraLayers.map((l) =>
      l instanceof StationLabelsLayer ? (l.clone({ onGlobe: true }) as Layer) : l
    ),
  ];
}

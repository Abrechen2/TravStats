import type { Layer } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import { estimateLabelBox, type PlacedLabel } from "./labelPriority";
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

/** Every label the given layers show, with its box. */
export function labelObstaclesOf(layers: readonly Layer[]): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const layer of layers) {
    if (!(layer instanceof TextLayer)) continue;
    const props = layer.props as unknown as TextLayerLike<unknown>;
    if (props.visible === false || !Array.isArray(props.data)) continue;
    const padding: [number, number] = props.background
      ? [props.backgroundPadding?.[0] ?? 0, props.backgroundPadding?.[1] ?? 0]
      : [0, 0];
    for (const d of props.data as unknown[]) {
      const position = read(props.getPosition, d, null as unknown as readonly [number, number]);
      const text = read(props.getText, d, "");
      if (!position || !text) continue;
      const { width, height } = estimateLabelBox(String(text), read(props.getSize, d, 32), padding);
      const offset = read(props.getPixelOffset, d, [0, 0] as readonly [number, number]);
      out.push({ position, width, height, offsetY: offset[1] ?? 0 });
    }
  }
  return out;
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

/** The map's own layers, then its extra layers placed around their labels. */
export function appendWithLabelObstacles(own: Layer[], extraLayers: Layer[]): Layer[] {
  return [...own, ...withLabelObstacles(extraLayers, own)];
}

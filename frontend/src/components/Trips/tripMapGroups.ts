// The trip map's layer groups: the unit the legend names and a toggle hides.
//
// A group is a reader's idea ("Bahn"), not a layer — rail alone is a line
// layer, a station layer and a station-name layer. Layers are mapped to their
// group by id, which is what every builder already gives them; a layer with no
// group (labels, arrows, the direction chevrons) is filtered through the data
// it was built from instead.

import type { Layer } from "@deck.gl/core";

export const LAYER_GROUPS = [
  "flights",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "rental",
  "tours",
  "lodging",
  "stops",
  "places",
  "recording",
  "shared",
] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];

/** How a group is drawn: a recording is a measured line, the rest are drawn between known points. */
export type GroupStyle = "recorded" | "schematic" | "point";

export const GROUP_STYLE: Record<LayerGroup, GroupStyle> = {
  flights: "schematic",
  cruise: "schematic",
  rail: "schematic",
  bus: "schematic",
  ferry: "schematic",
  rental: "schematic",
  tours: "schematic",
  lodging: "point",
  stops: "point",
  places: "point",
  recording: "recorded",
  shared: "recorded",
};

// Longest prefix first is not needed: no prefix contains another.
const ID_PREFIXES: ReadonlyArray<readonly [string, LayerGroup]> = [
  ["trip-flight-arcs", "flights"],
  ["trip-airports", "flights"],
  ["trip-cruise-paths", "cruise"],
  ["trip-tour-paths", "tours"],
  ["trip-rail", "rail"],
  ["trip-bus", "bus"],
  ["trip-ferry", "ferry"],
  ["trip-rental", "rental"],
  ["lodging-pins", "lodging"],
  ["trip-stops", "stops"],
  ["place-pins", "places"],
  ["trip-recording", "recording"],
  ["trip-shared-route", "shared"],
];

export function groupOfLayerId(id: string): LayerGroup | null {
  for (const [prefix, group] of ID_PREFIXES) if (id.startsWith(prefix)) return group;
  return null;
}

/** The layers whose group is not hidden. A layer with no group always stays. */
export function withoutHidden<T extends Layer>(
  layers: readonly T[],
  hidden: ReadonlySet<LayerGroup>
): T[] {
  if (hidden.size === 0) return [...layers];
  return layers.filter((layer) => {
    const group = groupOfLayerId(layer.id);
    return group === null || !hidden.has(group);
  });
}

const dataLength = (layer: Layer): number => {
  const data = layer.props.data as unknown;
  return Array.isArray(data) ? data.length : 1;
};

/** Which groups the given layers actually draw something for. */
export function groupsPresentIn(layers: readonly Layer[]): Set<LayerGroup> {
  const out = new Set<LayerGroup>();
  for (const layer of layers) {
    const group = groupOfLayerId(layer.id);
    if (group && dataLength(layer) > 0) out.add(group);
  }
  return out;
}

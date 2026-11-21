// Names on the trip map beyond the hotels.
//
// Hotels name themselves through `buildLodgingPins`. Everything else a trip
// visits — airports, stops, places — shares ONE budget here, so the map reveals
// more names as the reader zooms in (`labelBudget`) and never prints two on top
// of each other (`declutterByDistance`). The names then join `shareMapLabels`
// with the hotel names, which places them around one another.

import { TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { declutterByDistance, pickLabelled } from "../map/labelPriority";
import { TRIP_MAP_CHROME } from "./tripMapColors";
import { pickSequenceItems } from "./tripMapEmphasis";

export interface TripLabelItem {
  position: [number, number];
  text: string;
  kind: "airport" | "stop" | "place";
  /** 1-based place in the trip's order, when it has one. */
  seq?: number;
  dim?: boolean;
}

/** A stop outranks a place outranks an airport — an airport has its own code on the dot's card. */
const KIND_WEIGHT: Record<TripLabelItem["kind"], number> = { stop: 3, place: 2, airport: 1 };
const DIM_TEXT_ALPHA = 90;

/** The weight a label competes with: its kind, then an earlier number. */
function weightOf(item: TripLabelItem): number {
  return KIND_WEIGHT[item.kind] * 1000 - (item.seq ?? 999);
}

/** The names the zoom has room for, thinned by screen distance. */
export function pickTripLabels(items: readonly TripLabelItem[], zoom: number): TripLabelItem[] {
  const named = items.filter((i) => i.text.length > 0);
  return declutterByDistance(
    pickLabelled(named, weightOf, "important", zoom),
    weightOf,
    (i) => i.position,
    zoom
  );
}

type Rgba = [number, number, number, number];
const NUMBER_SIZE_PX = 10;
const NUMBER_CHIP: Rgba = [...TRIP_MAP_CHROME.labelText.slice(0, 3), 185] as Rgba;
const FONT = "'Inter', system-ui, sans-serif";

/**
 * The name layer (which `shareMapLabels` may thin further) and the number layer.
 * The numbers are kept apart: they sit below-right of the dot where no name goes,
 * and a number that vanished with a colliding name would break the sequence.
 */
export function buildTripLabelLayers(
  items: readonly TripLabelItem[],
  zoom: number,
  dayChosen = false
): { names: Layer; numbers: Layer | null } {
  const names = pickTripLabels(items, zoom);
  const labelText = (d: TripLabelItem): [number, number, number, number] =>
    d.dim
      ? ([...TRIP_MAP_CHROME.labelText.slice(0, 3), DIM_TEXT_ALPHA] as [
          number,
          number,
          number,
          number,
        ])
      : TRIP_MAP_CHROME.labelText;
  const namesLayer = new TextLayer<TripLabelItem>({
    id: "trip-name-labels",
    data: names,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getColor: labelText,
    getSize: 12,
    sizeUnits: "pixels",
    getTextAnchor: "middle",
    getAlignmentBaseline: "bottom",
    getPixelOffset: [0, -14],
    fontFamily: FONT,
    fontWeight: 600,
    outlineWidth: 3,
    outlineColor: TRIP_MAP_CHROME.outline,
    fontSettings: { sdf: true },
    // Names are user-entered and carry umlauts; the default character set is
    // ASCII-only and silently drops the rest (#185) — keep "auto".
    characterSet: "auto",
    pickable: false,
  });
  // Few, small, light (forgejo#424): see `pickSequenceItems` for when they show.
  const numbered = pickSequenceItems(items, zoom, dayChosen);
  const numbers =
    numbered.length === 0
      ? null
      : new TextLayer<TripLabelItem>({
          id: "trip-sequence",
          data: numbered,
          getPosition: (d) => d.position,
          getText: (d) => String(d.seq),
          // Dark ink on a light chip: the dot's own colour is often grey, and a
          // dark chip vanished on the dark basemap.
          getColor: () => TRIP_MAP_CHROME.outline,
          getSize: NUMBER_SIZE_PX,
          sizeUnits: "pixels",
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          getPixelOffset: [9, 9],
          fontFamily: FONT,
          fontWeight: 700,
          background: true,
          // Translucent chip: the route line under it stays readable.
          getBackgroundColor: () => NUMBER_CHIP,
          backgroundPadding: [3, 1],
          characterSet: "auto",
          pickable: false,
        });
  return { names: namesLayer, numbers };
}

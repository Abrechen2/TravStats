// Label data for the globe's lodging and place pins.
//
// Why a separate producer at all: deck.gl 9's billboard TextLayer/IconLayer
// does not render under MapLibre's globe projection in interleaved mode (the
// identical layer renders fine on the flat mercator map — see the note in
// GlobeLabelsOverlay). The globe therefore draws every label as a plain DOM
// pill, and these builders reduce a domain row to the four things a pill
// needs: what it says, where it is, how hard it fights for space, and what
// colour it is.
//
// The colour comes back through `resolveLodgingColor` / `resolvePlaceColor` —
// the same two functions the pin layers and the legend call — so a label can
// never name a colour its own dot does not have.
//
// ONE THING THE GLOBE CAN DO THAT THE FLAT MAP CANNOT: render a list's symbol.
// `placePinsLayer.ts` records the measurement — deck.gl builds its font atlas
// through a canvas, which cannot produce COLOUR EMOJI, so a glyph came out as
// an opaque black box drawn on top of the dot and the flat map needs an
// IconLayer with a real sprite atlas for it. A DOM pill has no such problem:
// the browser renders the emoji. So `labelSource` is honoured here directly.

import type { Lodging } from "../../types/lodging";
import type { Place } from "../../types/place";
import type { Rgb } from "../../lib/cruiseColor";
import { rgbCss } from "../../lib/flightColor";
import { resolveLodgingColor, type LodgingColorConfig } from "../../lib/lodgingColor";
import { resolvePlaceColor, type PlaceColorConfig } from "../../lib/placeColor";
import {
  resolvePlaceLabel,
  type PlaceLabelList,
  type PlaceLabelSource,
} from "../../lib/placeLabel";
import { toLodgingLabel } from "../layers/lodgingPinsLayer";
import { toPlaceLabel } from "../layers/placePinsLayer";
import { StationLabelsLayer } from "../layers/stationLabelsLayer";
import type { Layer } from "@deck.gl/core";

/** One DOM label pill the globe overlay projects and places. */
export interface GlobeExtraLabel {
  /** Only used to key the DOM node — `${kind}-${id}` is stable across frames. */
  kind: "lodging" | "place" | "station";
  id: string;
  text: string;
  lng: number;
  lat: number;
  /** Higher wins when two pills would overlap. Stays/visits, exactly the
   *  weights the flat layers hand to `pickLabelled`. */
  weight: number;
  /** CSS colour of the pill's text, from the domain's own colour config. */
  color: string;
}

export function lodgingLabelPoints(
  lodgings: readonly Lodging[],
  colors: LodgingColorConfig
): GlobeExtraLabel[] {
  const out: GlobeExtraLabel[] = [];
  for (const lodging of lodgings) {
    // Both coordinates or nothing: one of the pair is not a location, it is a
    // pin at NaN or a silent collapse to (0, lon). Same guard as the flat layer.
    if (lodging.lat === null || lodging.lon === null) continue;
    if (!Number.isFinite(lodging.lat) || !Number.isFinite(lodging.lon)) continue;
    const label = toLodgingLabel(lodging.name);
    if (label.length === 0) continue;
    out.push({
      kind: "lodging",
      id: lodging.id,
      text: label,
      lng: lodging.lon,
      lat: lodging.lat,
      weight: lodging.stayCount ?? 0,
      color: rgbCss(resolveLodgingColor(lodging, colors) as Rgb),
    });
  }
  return out;
}

export function placeLabelPoints(
  places: readonly Place[],
  colors: PlaceColorConfig,
  listColors?: ReadonlyMap<string, Rgb>,
  listLabels?: ReadonlyMap<string, PlaceLabelList>,
  labelSource?: PlaceLabelSource
): GlobeExtraLabel[] {
  const out: GlobeExtraLabel[] = [];
  for (const place of places) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const resolved = resolvePlaceLabel({
      source: labelSource,
      list: listLabels?.get(place.id) ?? null,
    });
    const text = resolved.kind === "icon" ? resolved.glyph : toPlaceLabel(place.name);
    if (text.length === 0) continue;
    out.push({
      kind: "place",
      id: place.id,
      text,
      lng: place.lon,
      lat: place.lat,
      weight: place.visitCount ?? 0,
      color: rgbCss(
        resolvePlaceColor({ visited: place.visited, listColor: listColors?.get(place.id) }, colors)
      ),
    });
  }
  return out;
}

/**
 * The rail, bus and ferry station names (forgejo#320). The dashboard tabs build
 * them as a `StationLabelsLayer` among the map's extra layers; on the globe
 * that layer draws nothing and only carries its stations here, so the names
 * come from the same rides — the same domain filter — the lines were drawn
 * from, in each domain's colour, weighted by how often a station was used.
 * The overlay's greedy cull then places them against the airport, port and
 * pin labels in one pass.
 */
export function stationLabelPoints(layers: readonly Layer[]): GlobeExtraLabel[] {
  return layers
    .filter((layer): layer is StationLabelsLayer => layer instanceof StationLabelsLayer)
    .flatMap((layer) =>
      layer.props.data.map((d) => ({
        kind: "station" as const,
        id: `${layer.id}-${d.key}`,
        text: d.shortLabel,
        lng: d.position[0],
        lat: d.position[1],
        weight: d.count,
        color: rgbCss(d.color),
      }))
    );
}

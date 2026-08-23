import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Place } from "../../types/place";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  resolvePlaceColor,
  type PlaceColorConfig,
} from "../../lib/placeColor";
import { PLACE_CATEGORY_ICONS, type PlaceCategory } from "../../shared/placeCategories";
import { markerDotRadiusProps } from "./markerDotStyle";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";

interface PlacePinDatum {
  position: [number, number];
  placeId: string;
  name: string;
  /** Truncated display label rendered by the name TextLayer — see `toPlaceLabel`. */
  shortLabel: string;
  category: PlaceCategory;
  /** The category glyph, drawn as its own layer above the dot. */
  icon: string;
  city: string | null;
  /**
   * Free text, exactly as `Lodging.country` is — deliberately NOT pre-resolved
   * here, because the tooltip renderer resolves it at render time the same way
   * (markerTooltip.ts). Resolving it twice, differently, is how the two drift.
   */
  country: string | null;
  /** Completed visits — feeds the tooltip and the label-priority weight. */
  visitCount: number;
  /** Logbook vs. wishlist. Drives BOTH the colour and the filled/hollow shape. */
  visited: boolean;
}

// Place names run long and unpredictable ("McDonald's Shibuya Center-Gai"),
// so labels truncate on the same budget lodging settled on, with the same
// ellipsis contract (never a dangling trailing space before "…").
const MAX_PLACE_LABEL_LEN = 20;

function toPlaceLabel(name: string, maxLen: number = MAX_PLACE_LABEL_LEN): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
}

/** Matches the port/lodging label zoom-budget default so a legacy or test
 *  caller that does not thread a real zoom still gets a sane budget. */
const PLACE_LABEL_DEFAULT_ZOOM = 4;

export interface PlacePinsAppearance {
  /** Fired when a pin is clicked. Returning `true` from the deck.gl handler
   *  marks the click handled — the same contract the airport dot and the
   *  lodging pin use so DeckGLMap's `deckClickedRef` guard can stop the
   *  background click from clearing the selection this click just made. */
  onPinClick?: (placeId: string) => void;
  colors?: PlaceColorConfig;
  labelsMode?: LabelsMode;
  /** Draw the category glyph above each dot. On the All tab this is what keeps
   *  a place distinguishable from a cruise port — see the note on
   *  `buildPlacePins`. */
  showIcons?: boolean;
}

/**
 * Place pins: a dot per place, an optional category glyph, and budgeted name
 * labels — the same three-part construction the lodging and cruise-port
 * layers use, sharing `markerDotStyle` so a place dot cannot drift in size
 * from an airport, port or lodging dot (pinned by dotSizeParity.test.ts).
 *
 * TWO ENCODINGS HERE ARE MEASUREMENTS, NOT PREFERENCES:
 *
 * 1. **Filled vs. hollow carries visited vs. wishlist.** The POI teal against
 *    the muted wishlist grey measures below the normal-vision colour-separation
 *    floor, so colour alone would not distinguish them for anyone. The shape
 *    does; the colour merely agrees.
 *
 * 2. **The category glyph is not decoration.** POI teal and cruise blue are
 *    the closest pair in the product's palette — also below that floor — and
 *    on the All tab place dots sit beside cruise-port dots at the same size.
 *    `showIcons` defaults to true for that reason. Turning it off inside the
 *    POI tab is safe (nothing else is on screen); turning it off on a shared
 *    map is not.
 *
 * Returns `null` when nothing qualifies, so callers omit the layers entirely
 * rather than mounting a no-op — the convention `createCruisePortsLayer` and
 * `buildLodgingPins` already follow.
 */
export function buildPlacePins(
  places: readonly Place[],
  sizeScale: number = 1,
  zoom: number = PLACE_LABEL_DEFAULT_ZOOM,
  appearance: PlacePinsAppearance = {}
): Layer[] | null {
  const {
    onPinClick,
    labelsMode = "important",
    colors = DEFAULT_PLACE_COLOR_CONFIG,
    showIcons = true,
  } = appearance;

  const data: PlacePinDatum[] = [];
  for (const place of places) {
    // `lat`/`lon` are non-nullable in the model, but a hand-edited payload or
    // a future importer could still deliver NaN — which would crash the layer
    // rather than skip a row, so it is worth one guard.
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    data.push({
      position: [place.lon, place.lat],
      placeId: place.id,
      name: place.name,
      shortLabel: toPlaceLabel(place.name),
      category: place.category,
      icon: PLACE_CATEGORY_ICONS[place.category] ?? PLACE_CATEGORY_ICONS.other,
      city: place.city,
      country: place.country,
      visitCount: place.visitCount,
      visited: place.visited,
    });
  }
  if (data.length === 0) return null;

  const layers: Layer[] = [];

  layers.push(
    new ScatterplotLayer<PlacePinDatum>({
      id: "place-pins",
      data,
      getPosition: (d) => d.position,
      ...markerDotRadiusProps(sizeScale),
      // A wishlist entry is drawn hollow: transparent fill, coloured ring.
      getFillColor: (d) =>
        d.visited
          ? ([...resolvePlaceColor(d, colors), 220] as [number, number, number, number])
          : ([0, 0, 0, 0] as [number, number, number, number]),
      getLineColor: (d) =>
        d.visited
          ? ([255, 255, 255, 220] as [number, number, number, number])
          : ([...resolvePlaceColor(d, colors), 235] as [number, number, number, number]),
      lineWidthUnits: "pixels",
      getLineWidth: (d) => (d.visited ? 1 : 2),
      stroked: true,
      pickable: true,
      updateTriggers: {
        getFillColor: [colors.mode, colors.colors],
        getLineColor: [colors.mode, colors.colors],
      },
      onClick: onPinClick
        ? ({ object }: { object?: PlacePinDatum }) => {
            if (!object?.placeId) return false;
            onPinClick(object.placeId);
            return true;
          }
        : undefined,
    })
  );

  if (showIcons) {
    layers.push(
      new TextLayer<PlacePinDatum>({
        id: "place-pins-icons",
        data,
        getPosition: (d) => d.position,
        getText: (d) => d.icon,
        getSize: 13,
        getPixelOffset: [0, -2],
        sizeUnits: "pixels",
        billboard: true,
        pickable: false,
        // Emoji live far outside deck.gl's default ASCII 32-127 atlas, which
        // would silently drop every glyph (the #185 class of bug). Declaring
        // the set explicitly is what makes them render at all.
        characterSet: new Set(Object.values(PLACE_CATEGORY_ICONS)),
      })
    );
  }

  // Priority label reveal, same as cruise ports and lodging: the most-visited
  // places keep their label even zoomed out, the rest fill in as the zoom
  // budget grows, then decluttered by screen distance so a dense city cluster
  // does not stack labels. Skipped in "all" mode, where the user explicitly
  // asked for every label.
  const budgeted = pickLabelled(data, (d) => d.visitCount, labelsMode, zoom);
  const labelData =
    labelsMode === "all"
      ? budgeted
      : declutterByDistance(
          budgeted,
          (d) => d.visitCount,
          (d) => d.position,
          zoom
        );

  layers.push(
    new TextLayer<PlacePinDatum>({
      id: "place-pins-labels",
      data: labelData,
      getPosition: (d) => d.position,
      getText: (d) => d.shortLabel,
      getColor: [241, 245, 249, 235],
      getSize: 11,
      fontFamily: "Inter, sans-serif",
      fontWeight: 700,
      background: true,
      backgroundPadding: [4, 2],
      getBackgroundColor: [13, 17, 23, 200],
      getBorderColor: [...resolvePlaceColor({ visited: true }, colors), 200] as [
        number,
        number,
        number,
        number,
      ],
      getBorderWidth: 1,
      getPixelOffset: [0, -16],
      sizeUnits: "pixels",
      pickable: true,
      billboard: true,
      // Place names carry umlauts and accents as routinely as lodging names do
      // ("Château de …", "Große Freiheit"). Same #185 fix: deck.gl's default
      // characterSet is ASCII-only, so anything outside it is dropped from the
      // atlas and never drawn.
      characterSet: "auto",
    })
  );

  return layers;
}

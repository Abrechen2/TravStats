import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Place } from "../../types/place";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  resolvePlaceColor,
  type PlaceColorConfig,
} from "../../lib/placeColor";
import type { Rgb } from "../../lib/cruiseColor";
import type { PlaceCategory } from "../../shared/placeCategories";
import { markerDotRadiusProps, MARKER_DOT_MAX_PX, MARKER_DOT_MIN_PX } from "./markerDotStyle";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";

interface PlacePinDatum {
  position: [number, number];
  placeId: string;
  name: string;
  /** Truncated display label rendered by the name TextLayer — see `toPlaceLabel`. */
  shortLabel: string;
  category: PlaceCategory;
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
  /** Resolved list colour in `list` mode; undefined for a place in no list.
   *  Baked into the datum so the colour accessor stays a pure lookup rather
   *  than closing over a map it would then have to declare as a trigger. */
  listColor?: Rgb;
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

/** How far the `target` ring sits outside the dot. 1.9× reads as a ring at
 *  every zoom the dot itself is clamped to, without colliding with a
 *  neighbouring pin at the tightest spacing the declutterer allows. */
const RING_FACTOR = 1.9;

export interface PlacePinsAppearance {
  /** Fired when a pin is clicked. Returning `true` from the deck.gl handler
   *  marks the click handled — the same contract the airport dot and the
   *  lodging pin use so DeckGLMap's `deckClickedRef` guard can stop the
   *  background click from clearing the selection this click just made. */
  onPinClick?: (placeId: string) => void;
  colors?: PlaceColorConfig;
  labelsMode?: LabelsMode;
  /**
   * Place id → the colour of the list it belongs to, as resolved by
   * `resolvePlaceListColors`. Only consulted in `list` mode. Passed in rather
   * than fetched here for the reason the whole colour contract exists: a layer
   * that resolved membership privately would be a second place deciding what a
   * pin means.
   */
  listColors?: ReadonlyMap<string, Rgb>;
  /**
   * Which MARK a place draws as.
   *
   *  - `dot`    the plain marker dot, on a map where places are the only pins.
   *  - `target` a ring around that dot. For the ALL tab, where a place shares
   *             the map with airport, port and lodging dots and has to be
   *             tellable apart from all three.
   *
   * A colour cannot do that job: POI teal against cruise-port blue measures
   * below the normal-vision separation floor, so on the All tab the two would
   * be one kind of dot in two barely-different shades. The intended answer was
   * a category emoji glyph, and deck.gl cannot render one (see below), so the
   * mark is geometry instead — which also survives greyscale and forced
   * colours, exactly as the shape encoding for wishlist pins does.
   */
  mark?: "dot" | "target";
}

/**
 * Place pins: a dot per place plus budgeted name labels — the same
 * construction the lodging and cruise-port layers use, sharing
 * `markerDotStyle` so a place dot cannot drift in size from an airport, port
 * or lodging dot (pinned by dotSizeParity.test.ts).
 *
 * TWO ENCODINGS HERE ARE MEASUREMENTS, NOT PREFERENCES:
 *
 * 1. **Filled vs. hollow carries visited vs. wishlist.** The POI teal against
 *    the muted wishlist grey measures below the normal-vision colour-separation
 *    floor, so colour alone would not distinguish them for anyone. The shape
 *    does; the colour merely agrees.
 *
 * 2. **There is no category glyph on the map, and that is a measurement too.**
 *    The plan called for one — category encoded as an icon rather than a hue,
 *    because only about three categorical colours survive the all-pairs
 *    separation test and there are eight categories. It was built, and then a
 *    browser showed what no unit test could: deck.gl's `TextLayer` renders
 *    text through a canvas-built font atlas, which cannot produce COLOUR
 *    EMOJI. Every glyph came out as an opaque black box drawn ON TOP of the
 *    dot, so the pin was not merely unlabelled, it was invisible. The whole
 *    suite was green throughout — the same trap the airline-logo work
 *    documents in CLAUDE.md, and the reason that note says to take a browser
 *    look rather than trust the tests.
 *
 *    Category therefore lives where it renders as ordinary DOM and is legible:
 *    the list rows, the detail page and the tooltip. Bringing it back to the
 *    map needs an `IconLayer` with a real sprite atlas, not a font.
 *
 *    CONSEQUENCE, NOW ANSWERED: the glyph was also the mark meant to separate
 *    a place from a cruise-port dot on the All tab (teal vs blue measures below
 *    the normal-vision floor). Places DO appear there now, and the answer is
 *    `mark: "target"` — a ring around the dot. Geometry, not hue, so it holds
 *    in greyscale and forced colours; and unlike an emoji it is drawn by the
 *    same ScatterplotLayer that already works.
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
    listColors,
    mark = "dot",
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
      city: place.city,
      country: place.country,
      visitCount: place.visitCount,
      visited: place.visited,
      listColor: listColors?.get(place.id),
    });
  }
  if (data.length === 0) return null;

  const layers: Layer[] = [];

  // The distinguishing ring goes UNDER the dot, so the dot keeps its exact
  // size and every place stays the same size as an airport or port dot
  // (pinned by dotSizeParity.test.ts) — the mark reads as "that dot, ringed"
  // rather than as a bigger dot.
  if (mark === "target") {
    layers.push(
      new ScatterplotLayer<PlacePinDatum>({
        id: "place-pins-ring",
        data,
        getPosition: (d) => d.position,
        getRadius: markerDotRadiusProps(sizeScale).getRadius,
        radiusMinPixels: MARKER_DOT_MIN_PX * sizeScale * RING_FACTOR,
        radiusMaxPixels: MARKER_DOT_MAX_PX * sizeScale * RING_FACTOR,
        filled: false,
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        getLineColor: (d) =>
          [...resolvePlaceColor(d, colors), d.visited ? 205 : 150] as [
            number,
            number,
            number,
            number,
          ],
        pickable: false,
        updateTriggers: { getLineColor: [colors.mode, colors.colors] },
      })
    );
  }

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
        // `listColors` is not a trigger: it is already baked into each datum,
        // and a new map identity re-creates `data` anyway.
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

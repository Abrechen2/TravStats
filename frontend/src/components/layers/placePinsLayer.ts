import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Place } from "../../types/place";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  resolvePlaceColor,
  type PlaceColorConfig,
} from "../../lib/placeColor";
import type { Rgb } from "../../lib/cruiseColor";
import type { PlaceCategory } from "../../shared/placeCategories";
import { markerDotRadiusProps } from "./markerDotStyle";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";
import {
  resolvePlaceLabel,
  type PlaceLabel,
  type PlaceLabelList,
  type PlaceLabelSource,
} from "../../lib/placeLabel";
import { emojiSprite, type EmojiSprite } from "./emojiSprite";

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
  /**
   * Name or symbol, already resolved through `resolvePlaceLabel`. Baked into
   * the datum for the same reason `listColor` is: the split between the two
   * label layers is then a pure read, and nothing downstream re-decides it.
   */
  label: PlaceLabel;
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
  /**
   * Place id → the colour of the list it belongs to, as resolved by
   * `resolvePlaceListColors`. Only consulted in `list` mode. Passed in rather
   * than fetched here for the reason the whole colour contract exists: a layer
   * that resolved membership privately would be a second place deciding what a
   * pin means.
   */
  listColors?: ReadonlyMap<string, Rgb>;
  /**
   * Place id → the label default of the list it belongs to. The SAME list that
   * `listColors` resolved, so a pin's colour and its symbol can never point at
   * two different lists.
   */
  listLabels?: ReadonlyMap<string, PlaceLabelList>;
  /**
   * The map-wide override. Absent means "as each list says" — an existing
   * user's stored appearance predates this setting, and reading absence as
   * "always names" would make turning a list to symbols appear to do nothing.
   */
  labelSource?: PlaceLabelSource;
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
 *    CONSEQUENCE, STILL OPEN: the glyph was also the mark meant to separate a
 *    place from a cruise-port dot on the All tab, where teal against port blue
 *    measures below the normal-vision separation floor. A ring around the dot
 *    (`mark: "target"`) shipped as that separator and was REMOVED on 2026-08-28
 *    by owner decision — a place is to read as the same plain dot every other
 *    domain draws. So on the All tab the two are again told apart by hue alone,
 *    which is known to be below the floor. If that turns out to matter in use,
 *    the fix is a distinguishable colour or a sprite-atlas IconLayer, not the
 *    ring: it was removed on purpose.
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
    listLabels,
    labelSource,
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
      label: resolvePlaceLabel({ source: labelSource, list: listLabels?.get(place.id) ?? null }),
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

  // The budget above governs BOTH label kinds, and the split happens after it.
  // Symbols exempt from the budget would pile into an unreadable heap exactly
  // where a list is dense, while the names beside them thinned out politely.
  //
  // A glyph this environment cannot rasterise downgrades to its name here
  // rather than vanishing: `emojiSprite` returns null, and an unlabelled pin
  // would be a worse answer than the name we already have.
  const sprites = new Map<string, EmojiSprite>();
  const nameData: PlacePinDatum[] = [];
  const symbolData: PlacePinDatum[] = [];
  for (const datum of labelData) {
    if (datum.label.kind === "icon") {
      const glyph = datum.label.glyph;
      let sprite = sprites.get(glyph);
      if (!sprite) {
        const made = emojiSprite(glyph);
        if (made) {
          sprite = made;
          sprites.set(glyph, made);
        }
      }
      if (sprite) {
        symbolData.push(datum);
        continue;
      }
    }
    nameData.push(datum);
  }

  if (symbolData.length > 0) {
    layers.push(
      new IconLayer<PlacePinDatum>({
        id: "place-pins-symbols",
        data: symbolData,
        getPosition: (d) => d.position,
        // deck.gl packs its own atlas from the per-datum descriptors, so no
        // pre-built sprite sheet has to be shipped or kept in step with the
        // lists a user invents.
        getIcon: (d) => sprites.get(d.label.kind === "icon" ? d.label.glyph : "")!,
        getSize: 22,
        sizeUnits: "pixels",
        // Same lift the name label uses, so a symbol and a name sit at the
        // same height above their dots on a mixed map.
        getPixelOffset: [0, -8],
        pickable: true,
        billboard: true,
        updateTriggers: {
          getIcon: [labelSource, symbolData.length],
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
  }

  layers.push(
    new TextLayer<PlacePinDatum>({
      id: "place-pins-labels",
      data: nameData,
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

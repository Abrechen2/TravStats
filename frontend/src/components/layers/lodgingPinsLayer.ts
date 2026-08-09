import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { DOMAINS } from "../../shared/domains";
import type { Lodging } from "../../types/lodging";
import { hexToRgb } from "../map/controlPanelKit";
import { markerDotRadiusProps } from "./markerDotStyle";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";

interface LodgingPinDatum {
  position: [number, number];
  lodgingId: string;
  name: string;
  /** Truncated display label rendered by the name TextLayer — see `toLodgingLabel`. */
  shortLabel: string;
  type: Lodging["type"];
  /** City the lodging is in — feeds the hover tooltip's place line. */
  city: string | null;
  /**
   * `Lodging.country` is free text — either an already-valid ISO 3166-1
   * alpha-2 code OR a full country name in German/English (see
   * `resolveCountryCode` in lib/countryFlag.tsx, and how
   * LodgingListPage/LodgingChainDetailPage already resolve it before handing
   * it to `FlagImg`). Deliberately NOT pre-resolved here — the tooltip
   * renderer (markerTooltip.ts) resolves it at render time the same way.
   */
  country: string | null;
  /** Total stays recorded at this lodging — feeds the hover tooltip and the label-priority weight. */
  stayCount: number;
  /** Total nights recorded at this lodging — feeds the hover tooltip. */
  nights: number;
}

// Brand lodging rose (BRAND.md §3), derived from the single source of truth
// `DOMAINS.lodging.color` (shared/domains.ts) rather than a second inlined
// hex — there's no CSS custom property for this domain yet (unlike
// --domain-flight/--domain-cruise), so this map layer needs the RGB tuple
// deck.gl expects. `hexToRgb` is the ONE shared implementation exported by
// controlPanelKit.tsx (Task 8) — this layer used to hand-roll its own copy.
const LODGING_RGB: [number, number, number] = hexToRgb(DOMAINS.lodging.color);

// Hotel/campsite names run much longer than the UN/LOCODE-derived port names
// `toPortLabel` (portLabel.ts) was built for ("Kempinski Hotel Bristol
// Berlin" vs "Travemünde"), so labels truncate at a wider budget here — same
// ellipsis contract (never a dangling trailing space before "…"), but no
// title-casing pass: unlike LOCODE data dumps, lodging names are never
// shouty all-caps source data.
const MAX_LODGING_LABEL_LEN = 20;

function toLodgingLabel(name: string, maxLen: number = MAX_LODGING_LABEL_LEN): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
}

// Matches the port label's zoom-budget default (PORT_LABEL_VISIBILITY_MIN_ZOOM
// in cruisePortsLayer.ts) — a legacy/test caller that doesn't thread a real
// zoom still gets a sane "modest budget of labels" default rather than none.
const LODGING_LABEL_DEFAULT_ZOOM = 4;

/** Appearance overrides for lodging-pin markers, threaded from DeckGLMap's flat-map panel. */
export interface LodgingPinsAppearance {
  /**
   * Fired when a pin is clicked — receives the lodging id. The deck.gl
   * onClick wrapper returns `true` once this fires so the click is marked
   * "handled" (same contract routesLayer's airport dot uses for
   * `handleAirportClick` — see DeckGLMap's `deckClickedRef` guard, which
   * relies on this to skip the background-click selection-clear).
   */
  onPinClick?: (lodgingId: string) => void;
  /**
   * Name-label reveal: off / key lodgings only (priority by stay count) /
   * all — the SAME `LabelsMode` the cruise-port labels use
   * (map/labelPriority.ts), driven by the same control-panel toggle.
   * Defaults to "important".
   */
  labelsMode?: LabelsMode;
}

/**
 * Build a ScatterplotLayer of lodging pins — one dot per hotel/campsite
 * with resolved coordinates — plus a name-label TextLayer. Sized via the
 * SAME model as the airport dot (`routesLayer.ts`'s `routes-dot`) and the
 * cruise-port dot (`cruisePortsLayer.ts`'s `cruise-ports`) —
 * `markerDotRadiusProps` from `markerDotStyle.ts` (#187) — so lodging
 * markers read as the same visual weight and respond to the same
 * size-slider semantics: `sizeScale` is the user's marker-size slider
 * multiplier (1 = default, 0 = "Aus" — the pixel radius clamps collapse to
 * 0, same as flight/cruise markers). `zoom` gates the label budget exactly
 * like the airport/port label layers (see `labelPriority.ts`).
 *
 * A `Lodging`'s `lat`/`lon` are independently nullable — set by the user
 * pinning a location manually or by the OSM geocoder on save, and either
 * can fail/be skipped. Only lodgings with BOTH coordinates present are
 * plotted; a lodging with just one of the pair is not a location (it would
 * plot at `NaN` and crash the layer, or silently collapse to `(0, lon)` /
 * `(lat, 0)`), so it's filtered out same as a fully coordinate-less one.
 *
 * Returns `null` when no lodging qualifies so callers can omit the layer(s)
 * entirely rather than mounting a no-op (same convention as
 * `createCruisePortsLayer`/`createCruiseArcsLayer`).
 */
export function buildLodgingPins(
  lodgings: readonly Lodging[],
  sizeScale: number = 1,
  zoom: number = LODGING_LABEL_DEFAULT_ZOOM,
  appearance: LodgingPinsAppearance = {}
): Layer[] | null {
  const { onPinClick, labelsMode = "important" } = appearance;
  const data: LodgingPinDatum[] = [];
  for (const lodging of lodgings) {
    if (lodging.lat === null || lodging.lon === null) continue;
    data.push({
      position: [lodging.lon, lodging.lat],
      lodgingId: lodging.id,
      name: lodging.name,
      shortLabel: toLodgingLabel(lodging.name),
      type: lodging.type,
      city: lodging.city,
      country: lodging.country,
      stayCount: lodging.stayCount,
      nights: lodging.nights,
    });
  }
  if (data.length === 0) return null;

  const pinLayer = new ScatterplotLayer<LodgingPinDatum>({
    id: "lodging-pins",
    data,
    getPosition: (d) => d.position,
    ...markerDotRadiusProps(sizeScale),
    getFillColor: [...LODGING_RGB, 220],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
    onClick: onPinClick
      ? ({ object }: { object?: LodgingPinDatum }) => {
          if (!object?.lodgingId) return false;
          onPinClick(object.lodgingId);
          // Mirrors the airport-dot contract: return true so deck.gl marks
          // this click as handled — the caller (DeckGLMap) uses this to set
          // its `deckClickedRef` guard, which stops the native background
          // click handler from immediately clearing whatever this click
          // just did (the same "Bug 1" class the flight/airport clicks
          // already guard against).
          return true;
        }
      : undefined,
  });

  // Priority label reveal, same as cruise ports: the most-visited lodgings
  // (highest stayCount) keep their label even zoomed out; the rest fill in
  // as the zoom budget grows. Decluttered by screen distance afterwards so a
  // dense city cluster of hotels doesn't stack labels — skipped in "all"
  // mode, where the user explicitly asked to see every label.
  const budgeted = pickLabelled(data, (d) => d.stayCount, labelsMode, zoom);
  const labelData =
    labelsMode === "all"
      ? budgeted
      : declutterByDistance(
          budgeted,
          (d) => d.stayCount,
          (d) => d.position,
          zoom
        );

  const labelLayer = new TextLayer<LodgingPinDatum>({
    id: "lodging-pins-labels",
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
    getBorderColor: [...LODGING_RGB, 200] as [number, number, number, number],
    getBorderWidth: 1,
    getPixelOffset: [0, -16],
    sizeUnits: "pixels",
    pickable: true,
    billboard: true,
    // Lodging names routinely carry umlauts/accents ("Zur Post München",
    // "Château de …"). Same #185 fix as the airport/port label layers:
    // deck.gl's default `characterSet` only covers ASCII 32-127, so anything
    // outside that range is silently dropped from the font atlas and never
    // renders. "auto" builds the atlas from the actual label text instead —
    // do not remove.
    characterSet: "auto",
    visible: labelsMode !== "off",
  });

  return [pinLayer, labelLayer];
}

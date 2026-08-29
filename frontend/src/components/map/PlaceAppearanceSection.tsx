// The POI domain's appearance controls.
//
// Extracted from `controlPanelKit.tsx` on 2026-08-29: that file had reached 977
// lines, over this project's 800-line hard maximum, and the label-source
// control below would only have pushed it further. The kit keeps the shared
// primitives every domain draws with; a domain's own section lives beside it.

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  PLACE_COLOR_MODES,
  PLACE_COLOR_PRESETS,
  slotsForPlaceMode,
  type PlaceColorConfig,
  type PlaceColorMode,
  type PlaceColorSlot,
} from "../../lib/placeColor";
import type { PlaceLabelSource } from "../../lib/placeLabel";
import type { Rgb } from "../../lib/cruiseColor";
import { ColorRow, HAIRLINE, SectionLabel, SegControl, Slider } from "./controlPanelKit";

/** Offered in the order a user reaches for them: the default first, then the
 *  two overrides. */
const PLACE_LABEL_SOURCES: readonly PlaceLabelSource[] = ["list", "name", "icon"];

export interface PlaceAppearanceState {
  colorConfig?: PlaceColorConfig;
  onColorModeChange?: (m: PlaceColorMode) => void;
  onColorChange?: (slot: PlaceColorSlot, c: Rgb) => void;
  /** Marker-size multiplier and its setter, threaded down from
   *  `MapContainer3D` exactly as the lodging pair is. Optional so a panel with
   *  no size story — or a test rendering only the colour controls — still gets
   *  a valid section instead of a dead slider. */
  markerSize?: number;
  onMarkerSizeChange?: (s: number) => void;
  /**
   * Whether pins are labelled with their place's name or their list's symbol.
   *
   * This is the map-wide OVERRIDE, not the setting itself: each list carries
   * its own default, and `list` — the value an unset store resolves to — means
   * "as each list says". The two overrides exist so one flip brings every name
   * back without editing a single list.
   */
  labelSource?: PlaceLabelSource;
  onLabelSourceChange?: (s: PlaceLabelSource) => void;
}

export interface PlaceAppearanceSectionProps extends PlaceAppearanceState {
  /** Uppercase section header ("Orte"). */
  title: string;
  /** Caption for the size slider. Required only when the slider is shown. */
  sizeLabel?: string;
}

/**
 * The POI domain's appearance controls: colour MODE, the colours it uses, what
 * the pins are labelled with, and the marker size.
 *
 * The marker-size slider was missing here until 2026-08-28, on the reasoning
 * that place pins share the airport/port dot sizing and had no size store of
 * their own — true at the time, and the reason both callers passed a hardcoded
 * `1`. But every neighbouring domain offers one, so the panel answered "how big
 * are my places" with silence. Places now own the same `markerSize` pair
 * lodging does, persisted through `mapAppearance`; the dot still shares
 * `markerDotStyle`, so a place at 1x remains exactly an airport dot's size.
 *
 * `list` mode shows only its FALLBACK colour: the rest of that mode's colours
 * are the user's own list colours, edited on the list itself. A second place to
 * set the same thing is a second place for it to be wrong. The label control
 * follows the same division — the SYMBOL is chosen on the list, and only the
 * question of whether the map honours it is answered here.
 */
export function PlaceAppearanceSection({
  title,
  colorConfig = DEFAULT_PLACE_COLOR_CONFIG,
  onColorModeChange,
  onColorChange,
  markerSize,
  onMarkerSizeChange,
  sizeLabel,
  labelSource = "list",
  onLabelSourceChange,
}: PlaceAppearanceSectionProps): JSX.Element | null {
  const { t } = useTranslation();
  const { mode, colors } = colorConfig;

  const showColors = Boolean(onColorModeChange && onColorChange);
  const showSize = markerSize !== undefined && onMarkerSizeChange !== undefined;
  const showLabels = Boolean(onLabelSourceChange);

  // Nothing to offer at all — render nothing rather than a dead header.
  if (!showColors && !showSize && !showLabels) return null;

  const modeOptions = PLACE_COLOR_MODES.map((m) => ({
    value: m,
    label: t(`map:globe.panel.placeColorMode.${m}.label`),
  }));

  return (
    <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
      <SectionLabel>{title}</SectionLabel>

      {showColors && onColorModeChange && onColorChange && (
        <>
          <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
            {t("map:globe.panel.placeColorMode.label")}
          </div>
          <SegControl<PlaceColorMode>
            value={mode}
            onChange={onColorModeChange}
            options={modeOptions}
          />
          <div
            className="mt-1 text-[10px] leading-snug"
            style={{ color: "rgba(241,245,249,0.45)" }}
          >
            {t(`map:globe.panel.placeColorMode.${mode}.hint`)}
          </div>

          {slotsForPlaceMode(mode).map((slot) => (
            <ColorRow
              key={slot}
              caption={t(`map:globe.panel.placeColorMode.swatch.${slot}`)}
              value={colors[slot]}
              presets={PLACE_COLOR_PRESETS}
              onChange={(c) => onColorChange(slot, c)}
            />
          ))}
        </>
      )}

      {showLabels && onLabelSourceChange && (
        <div className="mt-2.5">
          <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
            {t("map:globe.panel.placeLabelSource.label")}
          </div>
          <SegControl<PlaceLabelSource>
            value={labelSource}
            onChange={onLabelSourceChange}
            options={PLACE_LABEL_SOURCES.map((s) => ({
              value: s,
              label: t(`map:globe.panel.placeLabelSource.${s}.label`),
            }))}
          />
          <div
            className="mt-1 text-[10px] leading-snug"
            style={{ color: "rgba(241,245,249,0.45)" }}
          >
            {t(`map:globe.panel.placeLabelSource.${labelSource}.hint`)}
          </div>
        </div>
      )}

      {showSize && onMarkerSizeChange && (
        <Slider
          label={sizeLabel ?? t("map:globe.panel.size")}
          value={markerSize}
          min={0}
          max={1.6}
          step={0.1}
          onChange={onMarkerSizeChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      )}
    </div>
  );
}

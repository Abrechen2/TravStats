/**
 * The per-domain appearance sections of the map control panels.
 *
 * Split out of `controlPanelKit` on 2026-09-15 because that file is the
 * primitives — header, toggle, slider, colour field — and these two are the
 * domains rendered WITH them. The kit had grown past its frozen size, and the
 * cut that made it fit is also the one that was always right: a kit of parts
 * and the screens assembled from them are different things.
 *
 * The guarantee the kit's header states still holds and is the reason both
 * live in one shared place: the globe panel and the flat-map panel render the
 * very same section components, so the "Anpassung" controls cannot drift
 * between dashboard modes. `controlPanelKit` re-exports both, so every
 * existing importer is untouched.
 */

import { useTranslation } from "../../hooks/useTranslation";
import {
  AutoPill,
  CollapsibleSection,
  ColorField,
  ColorRow,
  SegControl,
  Slider,
} from "./controlPanelKit";
import {
  CRUISE_COLOR_MODES,
  CRUISE_COLOR_PRESETS,
  type CruiseColorConfig,
  type CruiseColorMode,
  type CruiseColorSlot,
  type Rgb,
} from "../../lib/cruiseColor";
import {
  FLIGHT_COLOR_MODES,
  FLIGHT_COLOR_PRESETS,
  type FlightColorConfig,
  type FlightColorMode,
  type FlightColorSlot,
} from "../../lib/flightColor";
import { FLIGHT_ROUTE_SHAPES, type FlightRouteShape } from "../../lib/flightRouteShape";
import {
  DEFAULT_LODGING_COLOR_CONFIG,
  LODGING_COLOR_MODES,
  LODGING_COLOR_PRESETS,
  slotsForMode,
  type LodgingColorConfig,
  type LodgingColorMode,
  type LodgingColorSlot,
} from "../../lib/lodgingColor";

/** Flight-domain appearance state, shared verbatim by both panels. */
export interface FlightAppearanceState {
  /** Mode + the four colour slots — read straight from `useFlightColorStore`. */
  colorConfig: FlightColorConfig;
  onColorModeChange: (mode: FlightColorMode) => void;
  onColorChange: (slot: FlightColorSlot, color: Rgb) => void;
  /**
   * Route SHAPE — 3D arcs or flat on the map surface (#183). FLAT-MAP ONLY:
   * the globe panel passes neither of these, and the shape picker is then not
   * rendered at all. That is deliberate — on a globe the arc is the whole
   * point, and a control that silently does nothing there would be worse than
   * no control. Both must be provided together for the picker to appear.
   */
  routeShape?: FlightRouteShape;
  onRouteShapeChange?: (shape: FlightRouteShape) => void;
  routeWidth: number;
  onRouteWidthChange: (w: number) => void;
  markerColor: Rgb | null;
  onMarkerColorChange: (c: Rgb | null) => void;
  markerSize: number;
  onMarkerSizeChange: (s: number) => void;
}

export interface FlightAppearanceSectionProps extends FlightAppearanceState {
  /** Uppercase section header ("Flüge"). */
  title: string;
  /** Airport-marker swatch label + its "Auto" reset pill text. */
  markerLabel: string;
  markerAutoLabel: string;
  markerDefault: Rgb;
  widthLabel: string;
  sizeLabel: string;
}

/**
 * The flight domain's appearance controls: colour MODE + the colours that
 * mode actually uses, then route width and airport-marker colour/size.
 *
 * Rendered identically by the globe panel and the flat-map panel — the two
 * must never drift, which is why this lives in the shared kit.
 */
export function FlightAppearanceSection({
  title,
  colorConfig,
  onColorModeChange,
  onColorChange,
  routeShape,
  onRouteShapeChange,
  routeWidth,
  onRouteWidthChange,
  markerColor,
  onMarkerColorChange,
  markerSize,
  onMarkerSizeChange,
  markerDefault,
  markerLabel,
  markerAutoLabel,
  widthLabel,
  sizeLabel,
}: FlightAppearanceSectionProps): JSX.Element {
  const { t } = useTranslation();
  const { mode, colors } = colorConfig;

  const modeOptions = FLIGHT_COLOR_MODES.map((m) => ({
    value: m,
    label: t(`map:globe.panel.colorMode.${m}.label`),
  }));

  const shapeOptions = FLIGHT_ROUTE_SHAPES.map((s) => ({
    value: s,
    label: t(`map:globe.panel.routeShape.${s}.label`),
  }));

  return (
    <CollapsibleSection id="flight" title={title}>
      {/* Route shape — 3D arcs or flat on the map surface (#183). Only the flat
          map wires this; on the globe the props are absent and the picker is
          simply not there. */}
      {routeShape && onRouteShapeChange && (
        <>
          <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
            {t("map:globe.panel.routeShape.label")}
          </div>
          <SegControl<FlightRouteShape>
            value={routeShape}
            onChange={onRouteShapeChange}
            options={shapeOptions}
          />
          <div
            className="mb-2 mt-1 text-[10px] leading-snug"
            style={{ color: "rgba(241,245,249,0.45)" }}
          >
            {t(`map:globe.panel.routeShape.${routeShape}.hint`)}
          </div>
        </>
      )}

      {/* Colour mode — the explicit choice that replaces the old
          "Frequenz" pill + hidden status override. */}
      <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
        {t("map:globe.panel.colorMode.label")}
      </div>
      <SegControl<FlightColorMode>
        value={mode}
        onChange={onColorModeChange}
        options={modeOptions}
      />
      <div className="mt-1 text-[10px] leading-snug" style={{ color: "rgba(241,245,249,0.45)" }}>
        {t(`map:globe.panel.colorMode.${mode}.hint`)}
      </div>

      {/* The colours the ACTIVE mode uses — nothing else, so the panel can
          never show a control that has no effect on the map. */}
      {mode === "status" && (
        <>
          <ColorRow
            caption={t("map:globe.panel.colorMode.swatchFlown")}
            value={colors.past}
            presets={FLIGHT_COLOR_PRESETS}
            onChange={(c) => onColorChange("past", c)}
          />
          <ColorRow
            caption={t("map:globe.panel.colorMode.swatchPlanned")}
            value={colors.upcoming}
            presets={FLIGHT_COLOR_PRESETS}
            onChange={(c) => onColorChange("upcoming", c)}
          />
        </>
      )}
      {mode === "frequency" && (
        <ColorRow
          caption={t("map:globe.panel.routes")}
          value={colors.frequency}
          presets={FLIGHT_COLOR_PRESETS}
          onChange={(c) => onColorChange("frequency", c)}
        />
      )}
      {mode === "solid" && (
        <ColorRow
          caption={t("map:globe.panel.routes")}
          value={colors.solid}
          presets={FLIGHT_COLOR_PRESETS}
          onChange={(c) => onColorChange("solid", c)}
        />
      )}

      {/* Route width slider */}
      <Slider
        label={widthLabel}
        value={routeWidth}
        min={0.3}
        max={2}
        step={0.1}
        onChange={onRouteWidthChange}
      />

      {/* Airport-marker colour + Auto reset */}
      <div className="mt-2 flex items-center justify-between gap-2 py-0.5">
        <ColorField
          label={markerLabel}
          value={markerColor ?? markerDefault}
          onChange={onMarkerColorChange}
        />
        <AutoPill
          active={markerColor === null}
          label={markerAutoLabel}
          onClick={() => onMarkerColorChange(null)}
        />
      </div>

      {/* Airport-marker size slider (0 = hidden) */}
      <div className="mt-1">
        <Slider
          label={sizeLabel}
          value={markerSize}
          min={0}
          max={1.6}
          step={0.1}
          onChange={onMarkerSizeChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      </div>
    </CollapsibleSection>
  );
}

// ── Cruise appearance section ────────────────────────────────────────
// The cruise mirror of the flight section: colour MODE first, then only the
// colours that mode actually uses, then width / port marker / arrows. Replaces
// the old generic "one colour + a Standard pill" section, which could not
// express the three things cruises are actually coloured by.

/** Cruise-domain appearance state, shared verbatim by both panels. */
export interface CruiseAppearanceState {
  /** Mode + the three colour slots — read straight from `useCruiseColorStore`. */
  colorConfig: CruiseColorConfig;
  onColorModeChange: (mode: CruiseColorMode) => void;
  onColorChange: (slot: CruiseColorSlot, color: Rgb) => void;
  routeWidth: number;
  onRouteWidthChange: (w: number) => void;
  markerColor: Rgb | null;
  onMarkerColorChange: (c: Rgb | null) => void;
  markerSize: number;
  onMarkerSizeChange: (s: number) => void;
  /** Direction-arrow size multiplier. Flat map only — the globe passes neither,
   *  and the slider is then not rendered. Both must be provided together. */
  arrowScale?: number;
  onArrowScaleChange?: (n: number) => void;
}

export interface CruiseAppearanceSectionProps extends CruiseAppearanceState {
  /** Uppercase section header ("Kreuzfahrten"). */
  title: string;
  /** Port-marker swatch label + its "Auto" reset pill text. */
  markerLabel: string;
  markerAutoLabel: string;
  markerDefault: Rgb;
  widthLabel: string;
  sizeLabel: string;
  arrowLabel?: string;
}

/**
 * The cruise domain's appearance controls: colour MODE ("status" / "perCruise"
 * / "solid") + the colours that mode uses, then route width, port-marker
 * colour/size and the direction-arrow slider.
 *
 * Rendered identically by the globe panel and the flat-map panel — the two must
 * never drift, which is why this lives in the shared kit.
 */
export function CruiseAppearanceSection({
  title,
  colorConfig,
  onColorModeChange,
  onColorChange,
  routeWidth,
  onRouteWidthChange,
  markerColor,
  onMarkerColorChange,
  markerSize,
  onMarkerSizeChange,
  markerDefault,
  markerLabel,
  markerAutoLabel,
  widthLabel,
  sizeLabel,
  arrowLabel,
  arrowScale,
  onArrowScaleChange,
}: CruiseAppearanceSectionProps): JSX.Element {
  const { t } = useTranslation();
  const { mode, colors } = colorConfig;

  const modeOptions = CRUISE_COLOR_MODES.map((m) => ({
    value: m,
    label: t(`map:globe.panel.cruiseColorMode.${m}.label`),
  }));

  return (
    <CollapsibleSection id="cruise" title={title}>
      {/* Colour mode — the explicit choice that replaces the per-tab hardcoded
          mode + the silent single-colour override. */}
      <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
        {t("map:globe.panel.cruiseColorMode.label")}
      </div>
      <SegControl<CruiseColorMode>
        value={mode}
        onChange={onColorModeChange}
        options={modeOptions}
      />
      <div className="mt-1 text-[10px] leading-snug" style={{ color: "rgba(241,245,249,0.45)" }}>
        {t(`map:globe.panel.cruiseColorMode.${mode}.hint`)}
      </div>

      {/* The colours the ACTIVE mode uses — nothing else, so the panel can
          never show a control that has no effect on the map. "perCruise" has
          no colour field at all: the colours come from the cruises. */}
      {mode === "status" && (
        <>
          <ColorRow
            caption={t("map:globe.panel.cruiseColorMode.swatchSailed")}
            value={colors.past}
            presets={CRUISE_COLOR_PRESETS}
            onChange={(c) => onColorChange("past", c)}
          />
          <ColorRow
            caption={t("map:globe.panel.cruiseColorMode.swatchPlanned")}
            value={colors.planned}
            presets={CRUISE_COLOR_PRESETS}
            onChange={(c) => onColorChange("planned", c)}
          />
        </>
      )}
      {mode === "solid" && (
        <ColorRow
          caption={t("map:globe.panel.routes")}
          value={colors.solid}
          presets={CRUISE_COLOR_PRESETS}
          onChange={(c) => onColorChange("solid", c)}
        />
      )}

      {/* Route width slider */}
      <Slider
        label={widthLabel}
        value={routeWidth}
        min={0.3}
        max={2}
        step={0.1}
        onChange={onRouteWidthChange}
      />

      {/* Port-marker colour + Auto reset */}
      <div className="mt-2 flex items-center justify-between gap-2 py-0.5">
        <ColorField
          label={markerLabel}
          value={markerColor ?? markerDefault}
          onChange={onMarkerColorChange}
        />
        <AutoPill
          active={markerColor === null}
          label={markerAutoLabel}
          onClick={() => onMarkerColorChange(null)}
        />
      </div>

      {/* Port-marker size slider (0 = hidden) */}
      <div className="mt-1">
        <Slider
          label={sizeLabel}
          value={markerSize}
          min={0}
          max={1.6}
          step={0.1}
          onChange={onMarkerSizeChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      </div>

      {/* Flat-map only: direction-arrow size slider */}
      {arrowScale != null && onArrowScaleChange && (
        <Slider
          label={arrowLabel ?? ""}
          value={arrowScale}
          min={0}
          max={2.5}
          step={0.1}
          onChange={onArrowScaleChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      )}
    </CollapsibleSection>
  );
}

// ── Lodging appearance section ───────────────────────────────────────
// Lodging pins have no routes, no colour mode and no width — a lodging is a
// single point, not a leg. So unlike Flight/CruiseAppearanceSection, this is
// ONE control: the shared marker-size slider (#187's model, threaded through
// `buildLodgingPins`'s `sizeScale` param). Kept as its own section (rather
// than folded into a generic "marker size" row) so it follows the exact same
// per-domain layout convention as Flüge/Kreuzfahrten — gated the same way by
// `appearanceDomains`.

/** Lodging-domain appearance state, shared verbatim by both panels. */
export interface LodgingAppearanceState {
  markerSize: number;
  onMarkerSizeChange: (s: number) => void;
  /** How pins are coloured. Optional so a panel that has no colour story to
   *  tell — a single-domain view with no legend — can omit it and get the
   *  slider alone, exactly as before. */
  colorConfig?: LodgingColorConfig;
  onColorModeChange?: (m: LodgingColorMode) => void;
  onColorChange?: (slot: LodgingColorSlot, c: [number, number, number]) => void;
}

export interface LodgingAppearanceSectionProps extends LodgingAppearanceState {
  /** Uppercase section header ("Unterkünfte"). */
  title: string;
  sizeLabel: string;
}

/**
 * The lodging domain's appearance controls: colour MODE ("solid" / "type" /
 * "rating" / "chain"), the colours that mode uses, and the marker-size slider.
 *
 * It used to be the slider alone, on the reasoning that lodging pins have no
 * routes to colour. True — but a pin still has to answer "which of these is
 * which", and a list of hundreds of houses has distinctions worth seeing.
 * Structure copied from the cruise section deliberately: only the ACTIVE
 * mode's colours are shown, so the panel can never offer a control that does
 * nothing to the map.
 */
export function LodgingAppearanceSection({
  title,
  colorConfig = DEFAULT_LODGING_COLOR_CONFIG,
  onColorModeChange,
  onColorChange,
  markerSize,
  onMarkerSizeChange,
  sizeLabel,
}: LodgingAppearanceSectionProps): JSX.Element {
  const { t } = useTranslation();
  const { mode, colors } = colorConfig;

  const modeOptions = LODGING_COLOR_MODES.map((m) => ({
    value: m,
    label: t(`map:globe.panel.lodgingColorMode.${m}.label`),
  }));

  return (
    <CollapsibleSection id="lodging" title={title}>
      {onColorModeChange && onColorChange && (
        <>
          <div className="mb-1 text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
            {t("map:globe.panel.lodgingColorMode.label")}
          </div>
          <SegControl<LodgingColorMode>
            value={mode}
            onChange={onColorModeChange}
            options={modeOptions}
          />
          <div
            className="mt-1 text-[10px] leading-snug"
            style={{ color: "rgba(241,245,249,0.45)" }}
          >
            {t(`map:globe.panel.lodgingColorMode.${mode}.hint`)}
          </div>

          {slotsForMode(mode).map((slot) => (
            <ColorRow
              key={slot}
              caption={t(`map:globe.panel.lodgingColorMode.swatch.${slot}`)}
              value={colors[slot]}
              presets={LODGING_COLOR_PRESETS}
              onChange={(c) => onColorChange(slot, c)}
            />
          ))}
        </>
      )}

      <Slider
        label={sizeLabel}
        value={markerSize}
        min={0}
        max={1.6}
        step={0.1}
        onChange={onMarkerSizeChange}
        format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
      />
    </CollapsibleSection>
  );
}

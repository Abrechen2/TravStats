// Shared building blocks for the map control panels (globe + flat 2D).
//
// Extracted from GlobeControlPanel so BOTH panels render from one source
// of truth — same tokens, same switch, same colour field, and (crucially)
// the same per-domain appearance sections. That guarantee is what keeps the
// "Anpassung" controls identical across every dashboard mode: the globe panel
// and the flat-map panel render the very same `FlightAppearanceSection` /
// `CruiseAppearanceSection`, so the two can never drift apart.

import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { loadMapAppearance, saveMapAppearance } from "./mapAppearance";
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
  rgbCss,
  type FlightColorConfig,
  type FlightColorMode,
  type FlightColorSlot,
} from "../../lib/flightColor";
import { FLIGHT_ROUTE_SHAPES, type FlightRouteShape } from "../../lib/flightRouteShape";

// ── Design tokens ────────────────────────────────────────────────────
export const ACCENT = "240,169,71"; // amber — the app's primary action colour
export const PANEL_BG = "rgba(13,17,23,0.85)";
export const HAIRLINE = "rgba(255,255,255,0.08)";
export const BORDER = "rgba(255,255,255,0.12)";
export const TEXT = "rgba(241,245,249,0.95)";

// ── RGB <-> hex helpers ──────────────────────────────────────────────
const clamp255 = (n: number): number => Math.max(0, Math.min(255, n));

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => clamp255(Math.round(c)).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// ── Native <option> styling ──────────────────────────────────────────
// The dropdown POPUP of a native <select> ignores the select's own colours on
// Windows (Chromium renders it with system colours) — with the panel's white
// text inherited onto unstyled options that was white-on-white (#196). Every
// <option> inside the dark glass panels must carry this style explicitly.
export const PANEL_OPTION_STYLE = { background: "#0d1117", color: "#f1f5f9" } as const;

// ── Collapsible panel header ─────────────────────────────────────────
/**
 * Expanded/collapsed state for the map control panels: collapsed by default
 * (owner decision on #194 — the panel is rarely needed, the map is), persisted
 * in the shared `mapAppearance` blob so the choice survives reloads and
 * carries across the 2D ↔ globe switch — it is the same panel to the user.
 *
 * Persisted only on an actual toggle, never on mount — writing the default
 * into the blob would bake it in and make any future default change a no-op
 * for everyone who ever loaded the app.
 */
export function usePanelExpanded(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => loadMapAppearance().panelExpanded ?? false);
  const toggle = useCallback(() => {
    const next = !expanded;
    saveMapAppearance({ panelExpanded: next });
    setExpanded(next);
  }, [expanded]);
  return [expanded, toggle];
}

/**
 * The shared clickable header of both map control panels.
 *
 * The chevron points where the panel body will MOVE on click (#195): the
 * panels are anchored bottom-left, so collapsing shrinks the body downwards
 * (chevron down while expanded) and expanding grows it upwards (chevron up
 * while collapsed).
 */
export function PanelHeader({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full shrink-0 cursor-pointer items-center justify-between px-3 py-2.5"
      style={{ background: "transparent" }}
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: TEXT }}>
        <span aria-hidden>🗺️</span>
        {title}
      </span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="h-4 w-4 shrink-0 transition-transform"
        style={{ transform: expanded ? "none" : "rotate(180deg)", opacity: 0.75, color: TEXT }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

// ── Section label ────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="mb-1.5 text-[10px] font-semibold uppercase"
      style={{ letterSpacing: "0.08em", color: "rgba(241,245,249,0.45)" }}
    >
      {children}
    </div>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────
export function Toggle({
  checked,
  onChange,
  icon,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: string;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-colors"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="flex items-center gap-2 text-xs font-medium" style={{ color: TEXT }}>
        <span aria-hidden style={{ opacity: 0.9 }}>
          {icon}
        </span>
        {label}
      </span>
      {/* Switch track */}
      <span
        className="relative inline-block shrink-0 rounded-full transition-colors"
        style={{
          width: 30,
          height: 17,
          background: checked ? `rgba(${ACCENT},0.9)` : "rgba(255,255,255,0.14)",
        }}
      >
        <span
          className="absolute rounded-full bg-white transition-transform"
          style={{
            width: 13,
            height: 13,
            top: 2,
            left: 2,
            transform: checked ? "translateX(13px)" : "translateX(0)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}
        />
      </span>
    </button>
  );
}

/** Small labelled colour-swatch input backed by a native <input type=color>. */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number, number];
  onChange: (c: [number, number, number]) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <span
        className="relative inline-block h-4 w-4 shrink-0 overflow-hidden rounded-sm"
        style={{ background: rgbToHex(value), border: "1px solid rgba(255,255,255,0.25)" }}
      >
        <input
          type="color"
          value={rgbToHex(value)}
          onChange={(e) => onChange(hexToRgb(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      {label && (
        <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.8)" }}>
          {label}
        </span>
      )}
    </label>
  );
}

/** Small pill toggle used for the "Frequenz"/"Standard"/"Auto" resets. */
function AutoPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors"
      style={{
        background: active ? `rgba(${ACCENT},0.16)` : "rgba(255,255,255,0.04)",
        color: active ? `rgb(${ACCENT})` : "rgba(241,245,249,0.7)",
        border: active ? `1px solid rgba(${ACCENT},0.55)` : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {label}
    </button>
  );
}

/** A segmented button row — the same visual grammar as the basemap grid.
 *  Reused for labels mode, marker-size presets, route-width presets, etc. */
export function SegControl<V extends string>({
  value,
  onChange,
  options,
  columns,
}: {
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: string; icon?: string }[];
  columns?: number;
}): JSX.Element {
  const cols = columns ?? options.length;
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              background: active ? `rgba(${ACCENT},0.16)` : "rgba(255,255,255,0.04)",
              color: active ? `rgb(${ACCENT})` : "rgba(241,245,249,0.72)",
              border: active
                ? `1px solid rgba(${ACCENT},0.55)`
                : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {opt.icon && (
              <span aria-hidden className="text-[13px] leading-none">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A continuous range slider with a live value readout on the right.
 *  Replaces the ordinal SegControls for line width + marker/arrow size —
 *  `format` renders the readout (default "1.4×"; pass a custom one to show
 *  "Aus" at 0). */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}): JSX.Element {
  const readout = (format ?? ((v: number) => `${v.toFixed(1)}×`))(value);
  return (
    <div className="mt-1.5">
      <div
        className="mb-1 flex items-center justify-between text-[11px]"
        style={{ color: "rgba(241,245,249,0.7)" }}
      >
        <span>{label}</span>
        <span style={{ color: `rgb(${ACCENT})`, fontVariantNumeric: "tabular-nums" }}>
          {readout}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: `rgb(${ACCENT})` }}
      />
    </div>
  );
}

// ── Per-domain appearance section ────────────────────────────────────
/** The map domains that get their own appearance section. Extend when a
 *  new domain (hotels, …) grows an on-map route/marker representation. */
export type AppearanceDomain = "flight" | "cruise" | "lodging";

// ── Colour-mode sections ─────────────────────────────────────────────
// Both domains colour their routes by an explicit MODE — not by a single
// colour plus an "auto" pill. The old pill was the reported "what does
// 'Frequenz' even do?" control: it looked like a reset button because it
// silently swapped between two invisible colouring systems. Cruises had it
// worse — their mode was not a control at all, it was hardcoded per tab.

/** Quick-pick swatch row + the free colour input for one colour slot. */
function ColorRow({
  caption,
  value,
  presets,
  onChange,
}: {
  caption: string;
  value: Rgb;
  presets: readonly Rgb[];
  onChange: (c: Rgb) => void;
}): JSX.Element {
  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
        {caption}
      </span>
      <span className="flex items-center gap-1">
        {presets.map((preset) => {
          const active = preset[0] === value[0] && preset[1] === value[1] && preset[2] === value[2];
          return (
            <button
              key={rgbCss(preset)}
              type="button"
              aria-label={rgbCss(preset)}
              onClick={() => onChange([preset[0], preset[1], preset[2]])}
              className="h-3 w-3 shrink-0 cursor-pointer rounded-full transition-transform"
              style={{
                background: rgbCss(preset),
                border: active
                  ? "1.5px solid rgba(255,255,255,0.95)"
                  : "1px solid rgba(255,255,255,0.2)",
                transform: active ? "scale(1.15)" : "none",
              }}
            />
          );
        })}
        <ColorField label="" value={value} onChange={onChange} />
      </span>
    </div>
  );
}

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
    <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
      <SectionLabel>{title}</SectionLabel>

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
    </div>
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
    <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
      <SectionLabel>{title}</SectionLabel>

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
    </div>
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
}

export interface LodgingAppearanceSectionProps extends LodgingAppearanceState {
  /** Uppercase section header ("Unterkünfte"). */
  title: string;
  sizeLabel: string;
}

/**
 * The lodging domain's appearance controls: just the marker-size slider
 * (0 = hidden). No colour/width/arrow controls — lodging pins have no
 * routes to colour or width, unlike flights/cruises.
 */
export function LodgingAppearanceSection({
  title,
  markerSize,
  onMarkerSizeChange,
  sizeLabel,
}: LodgingAppearanceSectionProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
      <SectionLabel>{title}</SectionLabel>
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
  );
}

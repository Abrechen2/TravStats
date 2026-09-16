// Shared building blocks for the map control panels (globe + flat 2D).
//
// Extracted from GlobeControlPanel so BOTH panels render from one source
// of truth — same tokens, same switch, same colour field, and (crucially)
// the same per-domain appearance sections. That guarantee is what keeps the
// "Anpassung" controls identical across every dashboard mode: the globe panel
// and the flat-map panel render the very same `FlightAppearanceSection` /
// `CruiseAppearanceSection`, so the two can never drift apart.

import { useCallback, useState } from "react";
import { loadMapAppearance, saveMapAppearance } from "./mapAppearance";
import { type Rgb } from "../../lib/cruiseColor";
import { rgbCss } from "../../lib/flightColor";

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
export function AutoPill({
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
            // Which option is chosen was conveyed by colour alone, so a screen
            // reader — and a test — had no way to ask. `aria-pressed` states it
            // programmatically, the same gap AUD-096 closed for the flight
            // update editor's labels.
            aria-pressed={active}
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
export type AppearanceDomain = "flight" | "cruise" | "lodging" | "poi";

// ── Colour-mode sections ─────────────────────────────────────────────
// Both domains colour their routes by an explicit MODE — not by a single
// colour plus an "auto" pill. The old pill was the reported "what does
// 'Frequenz' even do?" control: it looked like a reset button because it
// silently swapped between two invisible colouring systems. Cruises had it
// worse — their mode was not a control at all, it was hardcoded per tab.

/** Quick-pick swatch row + the free colour input for one colour slot. */
export function ColorRow({
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

// The per-domain sections live in `appearanceSections` — see its header for
// why. Re-exported here so the kit stays the single import site for the
// panels, exactly as before.
export {
  FlightAppearanceSection,
  CruiseAppearanceSection,
  LodgingAppearanceSection,
  type FlightAppearanceState,
  type FlightAppearanceSectionProps,
  type CruiseAppearanceState,
  type CruiseAppearanceSectionProps,
  type LodgingAppearanceState,
  type LodgingAppearanceSectionProps,
} from "./appearanceSections";

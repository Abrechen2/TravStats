// Shared building blocks for the map control panels (globe + flat 2D).
//
// Extracted from GlobeControlPanel so BOTH panels render from one source
// of truth — same tokens, same switch, same colour field, and (crucially)
// the same per-domain `AppearanceSection`. That guarantee is what keeps
// the "Anpassung" controls identical across every dashboard mode: the
// Flüge section and the Kreuzfahrten section are the exact same component
// with different labels + ranges.

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
        className="relative inline-block h-4 w-4 shrink-0 rounded"
        style={{ background: rgbToHex(value), border: "1px solid rgba(255,255,255,0.25)" }}
      >
        <input
          type="color"
          value={rgbToHex(value)}
          onChange={(e) => onChange(hexToRgb(e.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
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
      className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
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
              border: active ? `1px solid rgba(${ACCENT},0.55)` : "1px solid rgba(255,255,255,0.06)",
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

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-28 cursor-pointer"
        style={{ accentColor: `rgb(${ACCENT})` }}
      />
    </div>
  );
}

// ── Per-domain appearance section ────────────────────────────────────
/** The map domains that get their own appearance section. Extend when a
 *  new domain (hotels, …) grows an on-map route/marker representation. */
export type AppearanceDomain = "flight" | "cruise";

/**
 * One domain's appearance state + setters, shared verbatim by the globe
 * and the flat-map panel so both surface the identical control set. On
 * the globe `markerSize` is a pixel radius; on the flat map it's a size
 * multiplier — the section only slides a number, the units are the
 * panel's business.
 */
export interface DomainAppearanceState {
  routeColor: [number, number, number] | null;
  onRouteColorChange: (c: [number, number, number] | null) => void;
  arcWidthScale: number;
  onArcWidthScaleChange: (n: number) => void;
  markerColor: [number, number, number] | null;
  onMarkerColorChange: (c: [number, number, number] | null) => void;
  markerSize: number;
  onMarkerSizeChange: (n: number) => void;
}

export interface AppearanceSectionProps {
  /** Uppercase section header — the domain name ("Flüge" / "Kreuzfahrten"). */
  title: string;
  // Route row
  routeLabel: string;
  routeColor: [number, number, number] | null;
  /** Swatch shown when routeColor is null (the "auto" default tint). */
  routeDefault: [number, number, number];
  onRouteColorChange: (c: [number, number, number] | null) => void;
  /** Pill text for the route reset — "Frequenz" (flights) / "Standard" (cruises). */
  routeAutoLabel: string;
  widthLabel: string;
  width: number;
  widthMin: number;
  widthMax: number;
  widthStep: number;
  onWidthChange: (n: number) => void;
  // Marker row
  markerLabel: string;
  markerColor: [number, number, number] | null;
  markerDefault: [number, number, number];
  onMarkerColorChange: (c: [number, number, number] | null) => void;
  /** Pill text for the marker reset ("Auto"). */
  markerAutoLabel: string;
  sizeLabel: string;
  size: number;
  sizeMin: number;
  sizeMax: number;
  sizeStep: number;
  onSizeChange: (n: number) => void;
}

/**
 * One domain's slice of the appearance controls: route colour + width and
 * marker colour + size. Rendered identically for every domain so a user
 * sees the same layout whether they're tuning flights or cruises. Null
 * colour = "auto" (frequency heatmap for flight routes, brand default
 * otherwise); the pill toggles back to null.
 */
export function AppearanceSection({
  title,
  routeLabel,
  routeColor,
  routeDefault,
  onRouteColorChange,
  routeAutoLabel,
  widthLabel,
  width,
  widthMin,
  widthMax,
  widthStep,
  onWidthChange,
  markerLabel,
  markerColor,
  markerDefault,
  onMarkerColorChange,
  markerAutoLabel,
  sizeLabel,
  size,
  sizeMin,
  sizeMax,
  sizeStep,
  onSizeChange,
}: AppearanceSectionProps): JSX.Element {
  return (
    <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
      <SectionLabel>{title}</SectionLabel>

      {/* Route colour: "auto" (frequency / brand tint) or a solid custom colour. */}
      <div className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
          {routeLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <AutoPill
            active={routeColor === null}
            label={routeAutoLabel}
            onClick={() => onRouteColorChange(null)}
          />
          <ColorField label="" value={routeColor ?? routeDefault} onChange={onRouteColorChange} />
        </div>
      </div>

      {/* Route width */}
      <SliderRow
        label={widthLabel}
        value={width}
        min={widthMin}
        max={widthMax}
        step={widthStep}
        onChange={onWidthChange}
      />

      {/* Marker colour + Auto reset */}
      <div className="mt-1.5 flex items-center justify-between gap-2 py-0.5">
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

      {/* Marker size */}
      <SliderRow
        label={sizeLabel}
        value={size}
        min={sizeMin}
        max={sizeMax}
        step={sizeStep}
        onChange={onSizeChange}
      />
    </div>
  );
}

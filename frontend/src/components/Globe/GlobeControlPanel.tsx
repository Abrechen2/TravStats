// Consolidated map control panel for the globe.
//
// Replaces the four scattered floating clusters (Darstellung toggles,
// Routenfrequenz legend, basemap style strip, performance/recenter) with
// a single collapsible surface in the app's own design language: dark
// glass, hairline dividers, uppercase section labels, one amber accent.
//
// State lives in GlobeView; this component is presentation + callbacks
// only, so the same panel can later back the flat 2D map.

import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { Quartile } from "./heatmapUtils";

export type StyleId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";
export type LiteMode = "auto" | "on" | "off";

export interface GlobeControlPanelProps {
  autoRotate: boolean;
  onAutoRotateChange: (v: boolean) => void;
  showNight: boolean;
  onShowNightChange: (v: boolean) => void;
  showLabels: boolean;
  onShowLabelsChange: (v: boolean) => void;
  showTerrain: boolean;
  onShowTerrainChange: (v: boolean) => void;
  showPlaceLabels: boolean;
  onShowPlaceLabelsChange: (v: boolean) => void;

  styleOptions: readonly { id: StyleId; label: string }[];
  styleId: StyleId;
  onStyleChange: (id: StyleId) => void;

  liteMode: LiteMode;
  lite: boolean;
  onLiteModeChange: (m: LiteMode) => void;

  onRecenter: () => void;

  legendRanges: readonly { q: Quartile; color: string; label: string }[];
  activeQuartile: Quartile | null;
  onQuartileChange: (q: Quartile | null) => void;
  hasArcs: boolean;
  antipodalCount: number;
  hasWeakArcs: boolean;

  // Appearance customisation
  routeColor: [number, number, number] | null;
  onRouteColorChange: (c: [number, number, number] | null) => void;
  arcWidthScale: number;
  onArcWidthScaleChange: (n: number) => void;
  airportColor: [number, number, number];
  onAirportColorChange: (c: [number, number, number]) => void;
  portColor: [number, number, number];
  onPortColorChange: (c: [number, number, number]) => void;
  markerRadius: number;
  onMarkerRadiusChange: (n: number) => void;
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, n));

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => clamp255(Math.round(c)).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Small labelled colour-swatch input backed by a native <input type=color>. */
function ColorField({
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
      <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.8)" }}>
        {label}
      </span>
    </label>
  );
}

const ACCENT = "240,169,71"; // amber — the app's primary action colour
const PANEL_BG = "rgba(13,17,23,0.85)";
const HAIRLINE = "rgba(255,255,255,0.08)";
const BORDER = "rgba(255,255,255,0.12)";
const TEXT = "rgba(241,245,249,0.95)";

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="mb-1.5 text-[10px] font-semibold uppercase"
      style={{ letterSpacing: "0.08em", color: "rgba(241,245,249,0.45)" }}
    >
      {children}
    </div>
  );
}

function Toggle({
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

export function GlobeControlPanel({
  autoRotate,
  onAutoRotateChange,
  showNight,
  onShowNightChange,
  showLabels,
  onShowLabelsChange,
  showTerrain,
  onShowTerrainChange,
  showPlaceLabels,
  onShowPlaceLabelsChange,
  styleOptions,
  styleId,
  onStyleChange,
  liteMode,
  lite,
  onLiteModeChange,
  onRecenter,
  legendRanges,
  activeQuartile,
  onQuartileChange,
  hasArcs,
  antipodalCount,
  hasWeakArcs,
  routeColor,
  onRouteColorChange,
  arcWidthScale,
  onArcWidthScaleChange,
  airportColor,
  onAirportColorChange,
  portColor,
  onPortColorChange,
  markerRadius,
  onMarkerRadiusChange,
}: GlobeControlPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="flex w-[232px] flex-col overflow-hidden rounded-xl text-xs"
      style={{
        background: PANEL_BG,
        backdropFilter: "blur(14px)",
        border: `1px solid ${BORDER}`,
        color: TEXT,
        fontFamily: "'Inter', sans-serif",
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
        // Never taller than the space between the Aktivität toolbar row
        // and the bottom edge — the body scrolls when all sections open.
        maxHeight: "calc(100vh - 232px)",
      }}
    >
      {/* Header — click to collapse */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full shrink-0 cursor-pointer items-center justify-between px-3 py-2.5"
        style={{ background: "transparent" }}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: TEXT }}>
          <span aria-hidden>🗺️</span>
          {t("map:globe.panel.title")}
        </span>
        <span
          className="transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", opacity: 0.6 }}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="min-h-0 overflow-y-auto px-3 pb-3">
          {/* Layers */}
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="pt-2.5">
            <SectionLabel>{t("map:globe.panel.layers")}</SectionLabel>
            <div className="-mx-1 flex flex-col gap-0.5">
              <Toggle
                checked={showLabels}
                onChange={onShowLabelsChange}
                icon="🏷️"
                label={t("map:globe.panel.labels")}
              />
              <Toggle
                checked={showNight}
                onChange={onShowNightChange}
                icon="🌓"
                label={t("map:globe.panel.dayNight")}
              />
              <Toggle
                checked={showPlaceLabels}
                onChange={onShowPlaceLabelsChange}
                icon="🗺️"
                label={t("map:globe.panel.placeLabels")}
              />
              <Toggle
                checked={showTerrain}
                onChange={onShowTerrainChange}
                icon="⛰️"
                label={t("map:globe.panel.terrain")}
              />
              <Toggle
                checked={autoRotate}
                onChange={onAutoRotateChange}
                icon="🌍"
                label={t("map:globe.autoRotation")}
              />
            </div>
          </div>

          {/* Basemap */}
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
            <SectionLabel>{t("map:globe.panel.basemap")}</SectionLabel>
            <div className="grid grid-cols-3 gap-1">
              {styleOptions.map((opt) => {
                const active = opt.id === styleId;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onStyleChange(opt.id)}
                    className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      background: active ? `rgba(${ACCENT},0.16)` : "rgba(255,255,255,0.04)",
                      color: active ? `rgb(${ACCENT})` : "rgba(241,245,249,0.72)",
                      border: active
                        ? `1px solid rgba(${ACCENT},0.55)`
                        : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Appearance customisation — route + marker colours / sizes */}
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
            <SectionLabel>{t("map:globe.panel.appearance")}</SectionLabel>

            {/* Route colour: "frequency" (heatmap) or a solid custom tint */}
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
                {t("map:globe.panel.routes")}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onRouteColorChange(null)}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                  style={{
                    background: routeColor === null ? `rgba(${ACCENT},0.16)` : "rgba(255,255,255,0.04)",
                    color: routeColor === null ? `rgb(${ACCENT})` : "rgba(241,245,249,0.7)",
                    border:
                      routeColor === null
                        ? `1px solid rgba(${ACCENT},0.55)`
                        : "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {t("map:globe.panel.frequency")}
                </button>
                <ColorField
                  label=""
                  value={routeColor ?? [240, 169, 71]}
                  onChange={(c) => onRouteColorChange(c)}
                />
              </div>
            </div>

            {/* Route width */}
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
                {t("map:globe.panel.width")}
              </span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.25}
                value={arcWidthScale}
                onChange={(e) => onArcWidthScaleChange(Number(e.target.value))}
                className="h-1 w-28 cursor-pointer"
                style={{ accentColor: `rgb(${ACCENT})` }}
              />
            </div>

            {/* Marker colours */}
            <div className="mt-1.5 flex items-center justify-between gap-2 py-0.5">
              <ColorField
                label={t("map:globe.panel.airports")}
                value={airportColor}
                onChange={onAirportColorChange}
              />
              <ColorField
                label={t("map:globe.panel.ports")}
                value={portColor}
                onChange={onPortColorChange}
              />
            </div>

            {/* Marker size */}
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
                {t("map:globe.panel.size")}
              </span>
              <input
                type="range"
                min={3}
                max={10}
                step={0.5}
                value={markerRadius}
                onChange={(e) => onMarkerRadiusChange(Number(e.target.value))}
                className="h-1 w-28 cursor-pointer"
                style={{ accentColor: `rgb(${ACCENT})` }}
              />
            </div>
          </div>

          {/* Frequency filter (only when arcs exist) */}
          {hasArcs && (
            <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
              <SectionLabel>{t("map:globe.routeFrequency")}</SectionLabel>
              <div className="flex flex-col gap-0.5">
                {legendRanges.map(({ q, color, label }) => {
                  const active = activeQuartile === q;
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => onQuartileChange(active ? null : q)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 transition-colors"
                      style={{
                        background: active ? "rgba(255,255,255,0.09)" : "transparent",
                        opacity: activeQuartile === null || active ? 1 : 0.5,
                      }}
                      title={t("map:globe.quartileFilterHint")}
                    >
                      <span className="h-[3px] w-7 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[11px]">{label}</span>
                    </button>
                  );
                })}
              </div>
              {activeQuartile !== null && (
                <button
                  type="button"
                  onClick={() => onQuartileChange(null)}
                  className="mt-1 cursor-pointer text-[10px] underline opacity-70 hover:opacity-100"
                >
                  {t("map:globe.quartileFilterClear")}
                </button>
              )}
              {antipodalCount > 0 && (
                <div className="mt-1.5 text-[10px] opacity-60">
                  {t("map:globe.antipodalSimplified", { count: antipodalCount })}
                </div>
              )}
              {hasWeakArcs && (
                <div
                  className="mt-1.5 flex items-center gap-2 text-[10px] opacity-70"
                  title={t("map:globe.weakHint")}
                >
                  <svg width="28" height="2" viewBox="0 0 28 2" aria-hidden>
                    <line
                      x1="0"
                      y1="1"
                      x2="28"
                      y2="1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                  </svg>
                  <span>{t("map:globe.weak")}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions + performance */}
          <div
            style={{ borderTop: `1px solid ${HAIRLINE}` }}
            className="mt-2.5 flex items-center gap-2 pt-2.5"
          >
            <button
              type="button"
              onClick={onRecenter}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${BORDER}`,
                color: TEXT,
              }}
              title={t("map:globe.recenterHint")}
            >
              <span aria-hidden>🧭</span>
              {t("map:globe.recenter")}
            </button>
            <select
              value={liteMode}
              onChange={(e) => onLiteModeChange(e.target.value as LiteMode)}
              className="cursor-pointer rounded-md px-1.5 py-1.5 text-[11px]"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${BORDER}`,
                color: TEXT,
              }}
              title={t("map:globe.performanceHint")}
            >
              <option value="auto">
                ⚡ {t("map:globe.performanceAuto")} ({lite ? t("map:globe.performanceOn") : t("map:globe.performanceOff")})
              </option>
              <option value="on">⚡ {t("map:globe.performanceOn")}</option>
              <option value="off">⚡ {t("map:globe.performanceOff")}</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

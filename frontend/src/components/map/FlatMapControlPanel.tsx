// Consolidated control panel for the flat 2D routes map.
//
// Shares the globe panel's exact design language by reusing its exported
// building blocks (Toggle, ColorField, section tokens). The flat map has
// fewer axes than the globe — no auto-rotation / day-night / globe-only
// frequency filter — so this panel carries just the layers (place names,
// relief) and appearance (route + airport-marker) that apply here.

import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  Toggle,
  ColorField,
  SectionLabel,
  ACCENT,
  PANEL_BG,
  HAIRLINE,
  BORDER,
  TEXT,
} from "../Globe/GlobeControlPanel";

export interface FlatMapControlPanelProps {
  showPlaceLabels: boolean;
  onShowPlaceLabelsChange: (v: boolean) => void;
  showTerrain: boolean;
  onShowTerrainChange: (v: boolean) => void;

  routeColor: [number, number, number] | null;
  onRouteColorChange: (c: [number, number, number] | null) => void;
  arcWidthScale: number;
  onArcWidthScaleChange: (n: number) => void;
  markerColor: [number, number, number] | null;
  onMarkerColorChange: (c: [number, number, number] | null) => void;
  portColor: [number, number, number] | null;
  onPortColorChange: (c: [number, number, number] | null) => void;
  markerSizeScale: number;
  onMarkerSizeScaleChange: (n: number) => void;
}

// Defaults shown when a colour is null (Auto): airport amber, port blue.
const DEFAULT_MARKER: [number, number, number] = [240, 169, 71];
const DEFAULT_PORT: [number, number, number] = [56, 189, 248];

export function FlatMapControlPanel({
  showPlaceLabels,
  onShowPlaceLabelsChange,
  showTerrain,
  onShowTerrainChange,
  routeColor,
  onRouteColorChange,
  arcWidthScale,
  onArcWidthScaleChange,
  markerColor,
  onMarkerColorChange,
  portColor,
  onPortColorChange,
  markerSizeScale,
  onMarkerSizeScaleChange,
}: FlatMapControlPanelProps): JSX.Element {
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
        maxHeight: "calc(100vh - 200px)",
      }}
    >
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
            </div>
          </div>

          {/* Appearance */}
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
            <SectionLabel>{t("map:globe.panel.appearance")}</SectionLabel>

            {/* Route colour */}
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

            {/* Airport + port marker colours (Auto resets both to theme). */}
            <div className="mt-1.5 flex items-center justify-between gap-2 py-0.5">
              <ColorField
                label={t("map:globe.panel.airports")}
                value={markerColor ?? DEFAULT_MARKER}
                onChange={(c) => onMarkerColorChange(c)}
              />
              <ColorField
                label={t("map:globe.panel.ports")}
                value={portColor ?? DEFAULT_PORT}
                onChange={(c) => onPortColorChange(c)}
              />
              <button
                type="button"
                onClick={() => {
                  onMarkerColorChange(null);
                  onPortColorChange(null);
                }}
                className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  background:
                    markerColor === null && portColor === null
                      ? `rgba(${ACCENT},0.16)`
                      : "rgba(255,255,255,0.04)",
                  color:
                    markerColor === null && portColor === null
                      ? `rgb(${ACCENT})`
                      : "rgba(241,245,249,0.7)",
                  border:
                    markerColor === null && portColor === null
                      ? `1px solid rgba(${ACCENT},0.55)`
                      : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {t("map:globe.panel.auto")}
              </button>
            </div>

            {/* Marker size */}
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[11px]" style={{ color: "rgba(241,245,249,0.7)" }}>
                {t("map:globe.panel.size")}
              </span>
              <input
                type="range"
                min={0.4}
                max={2.5}
                step={0.1}
                value={markerSizeScale}
                onChange={(e) => onMarkerSizeScaleChange(Number(e.target.value))}
                className="h-1 w-28 cursor-pointer"
                style={{ accentColor: `rgb(${ACCENT})` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

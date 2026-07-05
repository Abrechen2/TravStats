// Consolidated control panel for the flat 2D routes map.
//
// Structurally identical to the globe panel: global EBENEN / BASISKARTE
// sections on top, then one stacked AppearanceSection per domain (Flüge /
// Kreuzfahrten), gated by `appearanceDomains`. The flat map has fewer
// global axes than the globe (no auto-rotation / day-night / frequency
// filter), but the per-domain appearance controls are the exact same
// component, so route + marker tuning reads the same across every mode.

import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  AppearanceSection,
  SectionLabel,
  SegControl,
  Toggle,
  ACCENT,
  PANEL_BG,
  HAIRLINE,
  BORDER,
  TEXT,
  type AppearanceDomain,
  type DomainAppearanceState,
} from "./controlPanelKit";
import { DEFAULT_CRUISE_ROUTE_COLOR } from "../Globe/buildGlobeLayers";
import type { LabelsMode } from "./labelPriority";

// Flat-map ranges. Marker + route widths are unitless multipliers here
// (the deck.gl layers apply them to their own pixel/meter bases).
const ROUTE_WIDTH = { min: 0.5, max: 3, step: 0.25 };
const MARKER_SIZE = { min: 0.4, max: 2.5, step: 0.1 };
const FLIGHT_ROUTE_DEFAULT: [number, number, number] = [240, 169, 71];
const FLIGHT_MARKER_DEFAULT: [number, number, number] = [240, 169, 71];
// Brand cruise blue — matches the port markers + the globe cruise routes.
const CRUISE_MARKER_DEFAULT: [number, number, number] = [111, 160, 214];

export interface FlatMapControlPanelProps {
  showPlaceLabels: boolean;
  onShowPlaceLabelsChange: (v: boolean) => void;
  showTerrain: boolean;
  onShowTerrainChange: (v: boolean) => void;
  labelsMode: LabelsMode;
  onLabelsModeChange: (v: LabelsMode) => void;

  styleOptions: readonly { id: string; label: string }[];
  styleId: string;
  onStyleChange: (id: string) => void;

  /** Which domain appearance sections to show, in render order. */
  appearanceDomains: readonly AppearanceDomain[];
  flightAppearance: DomainAppearanceState;
  cruiseAppearance: DomainAppearanceState;
}

export function FlatMapControlPanel({
  showPlaceLabels,
  onShowPlaceLabelsChange,
  showTerrain,
  onShowTerrainChange,
  labelsMode,
  onLabelsModeChange,
  styleOptions,
  styleId,
  onStyleChange,
  appearanceDomains,
  flightAppearance,
  cruiseAppearance,
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
            {/* Marker labels: off / key markers only / all */}
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2 px-1 text-xs font-medium" style={{ color: TEXT }}>
                <span aria-hidden style={{ opacity: 0.9 }}>🏷️</span>
                {t("map:globe.panel.labels")}
              </div>
              <SegControl<LabelsMode>
                value={labelsMode}
                onChange={onLabelsModeChange}
                options={[
                  { value: "off", label: t("map:globe.panel.off") },
                  { value: "important", label: t("map:globe.panel.labelsImportant") },
                  { value: "all", label: t("map:globe.panel.labelsAll") },
                ]}
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

          {/* Per-domain appearance sections (Flüge / Kreuzfahrten / …) */}
          {appearanceDomains.includes("flight") && (
            <AppearanceSection
              title={t("map:globe.panel.domainFlight")}
              routeLabel={t("map:globe.panel.routes")}
              routeColor={flightAppearance.routeColor}
              routeDefault={FLIGHT_ROUTE_DEFAULT}
              onRouteColorChange={flightAppearance.onRouteColorChange}
              routeAutoLabel={t("map:globe.panel.frequency")}
              widthLabel={t("map:globe.panel.width")}
              width={flightAppearance.arcWidthScale}
              widthMin={ROUTE_WIDTH.min}
              widthMax={ROUTE_WIDTH.max}
              widthStep={ROUTE_WIDTH.step}
              onWidthChange={flightAppearance.onArcWidthScaleChange}
              markerLabel={t("map:globe.panel.airports")}
              markerColor={flightAppearance.markerColor}
              markerDefault={FLIGHT_MARKER_DEFAULT}
              onMarkerColorChange={flightAppearance.onMarkerColorChange}
              markerAutoLabel={t("map:globe.panel.auto")}
              sizeLabel={t("map:globe.panel.size")}
              size={flightAppearance.markerSize}
              sizeMin={MARKER_SIZE.min}
              sizeMax={MARKER_SIZE.max}
              sizeStep={MARKER_SIZE.step}
              onSizeChange={flightAppearance.onMarkerSizeChange}
            />
          )}
          {appearanceDomains.includes("cruise") && (
            <AppearanceSection
              title={t("map:globe.panel.domainCruise")}
              routeLabel={t("map:globe.panel.routes")}
              routeColor={cruiseAppearance.routeColor}
              routeDefault={DEFAULT_CRUISE_ROUTE_COLOR}
              onRouteColorChange={cruiseAppearance.onRouteColorChange}
              routeAutoLabel={t("map:globe.panel.standard")}
              widthLabel={t("map:globe.panel.width")}
              width={cruiseAppearance.arcWidthScale}
              widthMin={ROUTE_WIDTH.min}
              widthMax={ROUTE_WIDTH.max}
              widthStep={ROUTE_WIDTH.step}
              onWidthChange={cruiseAppearance.onArcWidthScaleChange}
              markerLabel={t("map:globe.panel.ports")}
              markerColor={cruiseAppearance.markerColor}
              markerDefault={CRUISE_MARKER_DEFAULT}
              onMarkerColorChange={cruiseAppearance.onMarkerColorChange}
              markerAutoLabel={t("map:globe.panel.auto")}
              sizeLabel={t("map:globe.panel.size")}
              size={cruiseAppearance.markerSize}
              sizeMin={MARKER_SIZE.min}
              sizeMax={MARKER_SIZE.max}
              sizeStep={MARKER_SIZE.step}
              onSizeChange={cruiseAppearance.onMarkerSizeChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

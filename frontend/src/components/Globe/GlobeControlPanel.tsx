// Consolidated map control panel for the globe.
//
// One collapsible surface in the app's own design language: dark glass,
// hairline dividers, uppercase section labels, one amber accent. Global
// sections (Ebenen / Basiskarte) sit on top; below them the appearance
// controls are split into one stacked section PER DOMAIN (Flüge,
// Kreuzfahrten, …). Which domain sections show is driven by
// `appearanceDomains` so a single-domain tab only surfaces the relevant
// controls, while the Alle tab shows them all — and every domain section
// is the exact same `AppearanceSection`, so the layout stays identical
// across modes.
//
// State lives in GlobeView; this component is presentation + callbacks.

import { useTranslation } from "../../hooks/useTranslation";
import type { Quartile } from "./heatmapUtils";
import {
  CruiseAppearanceSection,
  FlightAppearanceSection,
  PanelHeader,
  SectionLabel,
  SegControl,
  Toggle,
  usePanelExpanded,
  ACCENT,
  PANEL_BG,
  HAIRLINE,
  BORDER,
  TEXT,
  PANEL_OPTION_STYLE,
  type AppearanceDomain,
  type CruiseAppearanceState,
  type FlightAppearanceState,
} from "../map/controlPanelKit";
import { MapChromeSections } from "../map/MapChromeSections";
import type { LabelsMode } from "../map/labelPriority";
import { DEFAULT_AIRPORT_COLOR, DEFAULT_PORT_COLOR } from "./buildGlobeLayers";

export type StyleId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";
export type LiteMode = "auto" | "on" | "off";

export interface GlobeControlPanelProps {
  autoRotate: boolean;
  onAutoRotateChange: (v: boolean) => void;
  showNight: boolean;
  onShowNightChange: (v: boolean) => void;
  labelsMode: LabelsMode;
  onLabelsModeChange: (v: LabelsMode) => void;
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

  /** Which domain appearance sections to show, in render order. */
  appearanceDomains: readonly AppearanceDomain[];
  flightAppearance: FlightAppearanceState;
  cruiseAppearance: CruiseAppearanceState;
}

export function GlobeControlPanel({
  autoRotate,
  onAutoRotateChange,
  showNight,
  onShowNightChange,
  labelsMode,
  onLabelsModeChange,
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
  appearanceDomains,
  flightAppearance,
  cruiseAppearance,
}: GlobeControlPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [expanded, toggleExpanded] = usePanelExpanded();

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
      <PanelHeader
        title={t("map:globe.panel.title")}
        expanded={expanded}
        onToggle={toggleExpanded}
      />

      {expanded && (
        <div className="scrollbar-none min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {/* Modus + Filter + Add — folded in from the old top toolbar */}
          <MapChromeSections />

          {/* Layers */}
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} className="mt-2.5 pt-2.5">
            <SectionLabel>{t("map:globe.panel.layers")}</SectionLabel>
            <div className="-mx-1 flex flex-col gap-0.5">
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
            {/* Marker labels: off / key markers only / all */}
            <div className="mt-2">
              <div
                className="mb-1 flex items-center gap-2 px-1 text-xs font-medium"
                style={{ color: TEXT }}
              >
                <span aria-hidden style={{ opacity: 0.9 }}>
                  🏷️
                </span>
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
            <FlightAppearanceSection
              title={t("map:globe.panel.domainFlight")}
              {...flightAppearance}
              markerDefault={DEFAULT_AIRPORT_COLOR}
              markerLabel={t("map:globe.panel.airports")}
              markerAutoLabel={t("map:globe.panel.auto")}
              widthLabel={t("map:globe.panel.width")}
              sizeLabel={t("map:globe.panel.size")}
            />
          )}
          {appearanceDomains.includes("cruise") && (
            <CruiseAppearanceSection
              title={t("map:globe.panel.domainCruise")}
              {...cruiseAppearance}
              markerDefault={DEFAULT_PORT_COLOR}
              markerLabel={t("map:globe.panel.ports")}
              markerAutoLabel={t("map:globe.panel.auto")}
              widthLabel={t("map:globe.panel.width")}
              sizeLabel={t("map:globe.panel.size")}
            />
          )}

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
                      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 transition-colors"
                      style={{
                        background: active ? "rgba(255,255,255,0.09)" : "transparent",
                        opacity: activeQuartile === null || active ? 1 : 0.5,
                      }}
                      title={t("map:globe.quartileFilterHint")}
                    >
                      <span
                        className="h-[3px] w-7 rounded-full"
                        style={{ backgroundColor: color }}
                      />
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
                colorScheme: "dark",
              }}
              title={t("map:globe.performanceHint")}
            >
              {/* Options MUST be styled explicitly — the popup ignores the
                  select's colours on Windows and was white-on-white (#196). */}
              <option value="auto" style={PANEL_OPTION_STYLE}>
                ⚡ {t("map:globe.performanceAuto")} (
                {lite ? t("map:globe.performanceOn") : t("map:globe.performanceOff")})
              </option>
              <option value="on" style={PANEL_OPTION_STYLE}>
                ⚡ {t("map:globe.performanceOn")}
              </option>
              <option value="off" style={PANEL_OPTION_STYLE}>
                ⚡ {t("map:globe.performanceOff")}
              </option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

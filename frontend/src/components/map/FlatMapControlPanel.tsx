// Consolidated control panel for the flat 2D routes map.
//
// Structurally identical to the globe panel: global EBENEN / BASISKARTE
// sections on top, then one stacked AppearanceSection per domain (Flüge /
// Kreuzfahrten), gated by `appearanceDomains`. The flat map has fewer
// global axes than the globe (no auto-rotation / day-night / frequency
// filter), but the per-domain appearance controls are the exact same
// component, so route + marker tuning reads the same across every mode.

import { useTranslation } from "../../hooks/useTranslation";
import {
  CruiseAppearanceSection,
  FlightAppearanceSection,
  LodgingAppearanceSection,
  PlaceAppearanceSection,
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
  type AppearanceDomain,
  type CruiseAppearanceState,
  type FlightAppearanceState,
  type LodgingAppearanceState,
  type PlaceAppearanceState,
} from "./controlPanelKit";
import { MapChromeSections } from "./MapChromeSections";
import type { LabelsMode } from "./labelPriority";

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
  flightAppearance: FlightAppearanceState;
  cruiseAppearance: CruiseAppearanceState;
  lodgingAppearance: LodgingAppearanceState;
  placeAppearance: PlaceAppearanceState;
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
  lodgingAppearance,
  placeAppearance,
}: FlatMapControlPanelProps): JSX.Element {
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
        maxHeight: "calc(100vh - 200px)",
      }}
    >
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
              markerDefault={FLIGHT_MARKER_DEFAULT}
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
              markerDefault={CRUISE_MARKER_DEFAULT}
              markerLabel={t("map:globe.panel.ports")}
              markerAutoLabel={t("map:globe.panel.auto")}
              widthLabel={t("map:globe.panel.width")}
              sizeLabel={t("map:globe.panel.size")}
              arrowLabel={t("map:globe.panel.arrows")}
            />
          )}
          {appearanceDomains.includes("lodging") && (
            <LodgingAppearanceSection
              title={t("map:globe.panel.domainLodging")}
              {...lodgingAppearance}
              sizeLabel={t("map:globe.panel.size")}
            />
          )}
          {appearanceDomains.includes("poi") && (
            <PlaceAppearanceSection
              title={t("map:globe.panel.domainPlace")}
              {...placeAppearance}
            />
          )}
        </div>
      )}
    </div>
  );
}

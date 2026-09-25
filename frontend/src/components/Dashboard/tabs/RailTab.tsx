import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useDashboardRail } from "../../../hooks/useDashboardRail";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useRailVisible } from "../../../hooks/useRailVisible";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { formatStationTime } from "../../../lib/railTime";
import MapContainer3D from "../../MapContainer3D";
import { ATTRIBUTION_CLEARANCE } from "../../map/attributionClearance";
import { SidebarToggle } from "../SidebarToggle";
import { legendRow } from "./allTabLegendRows";
import { buildRailLegendRows, buildRailMapLayers } from "./railMapOverlay";

const PANEL_STYLE = {
  background: "rgba(22,27,34,0.85)",
  color: "var(--text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
} as const;

/**
 * The dashboard's rail tab (spec 2026-09-25-rail-domain, phase 2b): every
 * train ride as a line — the traced line where Transitous gave one, the
 * straight line otherwise, and the legend says which is which — plus a list of
 * the rides. Two modes like the tour tab: the flat map and the globe, which
 * every tab opens on (owner ruling 2026-09-20).
 *
 * The colour is the domain colour store's (`useDomainColors`), for the line and
 * the key alike. The fetch is gated on `useRailVisible` — beta switch AND the
 * user's domain — so a hidden rail never reaches the network from here, even
 * if a guard above were wrong.
 */
export function RailTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const { t, i18n } = useTranslation(["dashboard", "rail", "common"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const railVisible = useRailVisible();
  const year = useDashboardFilterStore((s) => s.year);
  const { journeys, loading, loadError, reload } = useDashboardRail(railVisible, year);
  const { colorOf } = useDomainColors();
  const color = colorOf("rail");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const visMode = mode === "globe" ? "globe" : "routes";

  const layers = useMemo<Layer[]>(
    () => buildRailMapLayers(journeys, color, visMode === "globe"),
    [journeys, color, visMode]
  );
  const legend = buildRailLegendRows(journeys, color, t, legendRow);
  const isEmpty = !loading && !loadError && journeys.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0 }} data-testid="rail-tab">
      <MapContainer3D
        flights={[]}
        visMode={visMode}
        extraLayers={layers}
        appearanceDomains={[]}
        showInternalCruises={false}
        hideInfoPill
      />

      <SidebarToggle
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        label={t("dashboard:railTab.listTitle")}
      />

      {sidebarOpen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: 320,
            background: "rgba(22,27,34,0.95)",
            borderRight: "1px solid var(--color-border)",
            zIndex: 20,
            overflowY: "auto",
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}
          >
            <strong>{t("dashboard:railTab.listTitle")}</strong>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label={t("common:buttons.close")}
              style={{ background: "none", border: "none", color: "inherit", fontSize: 18 }}
            >
              ×
            </button>
          </div>
          {!loading && !loadError && (
            <ul>
              {journeys.map((j) => (
                <li
                  key={j.id}
                  style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)" }}
                  className="text-[13px]"
                >
                  <Link to={`/rail/${j.id}`} className="font-semibold hover:underline">
                    {j.depStationName} → {j.arrStationName}
                  </Link>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {formatStationTime(j.departureTime, j.depTimezone, locale)}
                    {j.distanceKm !== null &&
                      ` · ${Math.round(j.distanceKm).toLocaleString(locale)} km`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {legend.length > 0 && (
        <div
          className="flex flex-col"
          style={{
            ...PANEL_STYLE,
            position: "absolute",
            bottom: ATTRIBUTION_CLEARANCE,
            right: 12,
            zIndex: 30,
            gap: 6,
            padding: "8px 12px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
          data-testid="rail-legend"
        >
          {legend}
        </div>
      )}

      {(loading || loadError || isEmpty) && (
        <div
          role={loadError ? "alert" : "status"}
          style={{
            ...PANEL_STYLE,
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "6px 14px",
            fontSize: 13,
          }}
        >
          {loading
            ? t("dashboard:railTab.loading")
            : loadError
              ? t("dashboard:railTab.loadError")
              : t("dashboard:railTab.empty")}
          {loadError && (
            <button type="button" className="ml-2 underline" onClick={reload}>
              {t("common:buttons.retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

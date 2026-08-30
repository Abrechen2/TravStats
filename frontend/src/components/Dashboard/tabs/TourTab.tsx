import { useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Layer } from "@deck.gl/core";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useDashboardTours } from "../../../hooks/useDashboardTours";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TourSummary } from "../../../lib/api/tourIndex";
import { LEG_MODES, type LegMode } from "../../../types/tour";
import { buildTourPaths, type TourPathDatum } from "../../layers/tourPathsLayer";
import { buildTourDeckLayers, buildTourLegendRows, TourStatusOverlay } from "./tourMapOverlay";
import { legendRow } from "./allTabLegendRows";
import MapContainer3D from "../../MapContainer3D";

/**
 * Bottom offset for overlays in MapLibre's attribution corner — the same
 * 44 px bar plus 8 px breathing room every other dashboard overlay uses
 * (AllTab.tsx documents the exact measurement).
 */
const ATTRIBUTION_CLEARANCE = 52;

function isLegMode(value: string): value is LegMode {
  return (LEG_MODES as readonly string[]).includes(value);
}

/**
 * The dedicated "Touren" tab: the SAME tour-path map layer + mode legend
 * `tourMapOverlay.tsx` built for the "Alle" map (task 2), here as the only
 * thing on the map, plus a list of every tour section the user owns across
 * every trip — trip name, distance, stop count. Reuses `useDashboardTours`
 * verbatim; this tab fetches nothing of its own.
 *
 * Gated behind the `tourRoutes` beta flag ONLY. A tour is not a domain (see
 * the union split in types/dashboard.ts), so there is no `useEnabledDomains`
 * check and no `DomainDisabledNotice` stub here — `DashboardPage` already
 * refuses a direct `/dashboard/tour` load while the gate is off (mirrors the
 * `/dashboard/poi` fix), and the tab strip hides the tab entirely under the
 * same flag. The `toursAllowed` check below is defensive belt-and-braces
 * for the same reason AllTab keeps its own copy: `useDashboardTours`'s
 * `enabled` argument is what actually stops the fetch if either upstream
 * guard is ever wrong.
 */
export function TourTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const navigate = useNavigate();
  const { t } = useTranslation(["dashboard", "trips"]);
  const { isFeatureVisible } = useBetaFeatures();
  const toursAllowed = isFeatureVisible("tourRoutes");
  const dashboardTours = useDashboardTours(toursAllowed);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const tourPathData = useMemo<TourPathDatum[]>(
    () => (toursAllowed ? buildTourPaths(dashboardTours.geometries) : []),
    [toursAllowed, dashboardTours.geometries]
  );
  const tourLayers = useMemo<Layer[]>(() => buildTourDeckLayers(tourPathData), [tourPathData]);

  // The same swatch-JSX builder AllTab.tsx's "Alle" map legend uses —
  // shared in `./allTabLegendRows.tsx` since the fix-round review
  // (2026-08-30) found this tab had grown its own byte-identical copy.
  // Called with the default "line" shape (its only use here).
  const tourLegend = buildTourLegendRows(toursAllowed, dashboardTours, t, legendRow);

  // Settled + genuinely nothing to show — distinct from `toursLoading` and
  // `toursLoadError`, which TourStatusOverlay renders instead. Never derive
  // this from `tours.length === 0` alone: that is also true while loading or
  // after a failed request, and a tour count of zero next to a failed
  // request is exactly the lie this feature's own briefs warn about.
  const isEmpty =
    toursAllowed &&
    !dashboardTours.toursLoading &&
    !dashboardTours.toursLoadError &&
    dashboardTours.tours.length === 0;

  const handleRowClick = (tour: TourSummary): void => {
    navigate(`/trips/${tour.tripId}/route/${tour.id}`);
  };

  // Defensive belt-and-braces guard (see the doc comment above) actually
  // firing: the beta flag flipped off after this tab was already mounted.
  // Render "this feature is unavailable", never the ordinary empty-list
  // state -- `dashboardTours.tours` is `[]` here too (useDashboardTours
  // clears it the instant `enabled` goes false), and reusing the empty
  // copy would tell the user "you have no tours" when the true answer is
  // "you cannot see this at all right now". Found in the fix-round review
  // (2026-08-30): a stale mount hit exactly this branch and rendered the
  // ordinary empty-state text instead.
  if (!toursAllowed) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: 32,
            textAlign: "center",
            background: "rgba(15, 23, 42, 0.85)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            color: "var(--text-muted)",
          }}
        >
          {t("dashboard:tourTab.unavailable")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={[]}
        visMode={mode === "globe" ? "globe" : "routes"}
        extraLayers={tourLayers}
        // No per-domain appearance section applies here — tour leg colour
        // comes from the fixed LegMode palette (tourPathsLayer.ts), not a
        // user-configurable colour mode like flight/cruise/lodging/poi.
        appearanceDomains={[]}
        // Without this the map fetches and draws every cruise route
        // underneath the tour lines (defaults to true).
        showInternalCruises={false}
        hideInfoPill
      />

      <button
        type="button"
        onClick={() => setSidebarOpen((prev) => !prev)}
        style={{
          position: "absolute",
          top: 12,
          left: sidebarOpen ? 340 : 12,
          zIndex: 30,
          padding: "6px 12px",
          borderRadius: 10,
          background: "rgba(22,27,34,0.85)",
          border: "1px solid var(--color-border)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ☰ {t("dashboard:tourTab.listTitle")}
      </button>

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
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <strong>{t("dashboard:tourTab.listTitle")}</strong>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="close"
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>

          {/* While loading or after a failed request, the top banner
              (TourStatusOverlay below) already carries that state — the
              list body itself only ever shows a SETTLED answer: rows, or
              the empty message, never a stale/zero list dressed up as one. */}
          {!dashboardTours.toursLoading &&
            !dashboardTours.toursLoadError &&
            (dashboardTours.tours.length === 0 ? (
              <p style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
                {t("dashboard:tourTab.listEmpty")}
              </p>
            ) : (
              dashboardTours.tours.map((tour) => (
                <div
                  key={tour.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowClick(tour)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(tour);
                    }
                  }}
                  className="activity-row hover:bg-white/4"
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ flex: 1 }}>{tour.name}</strong>
                    <span
                      style={{
                        borderRadius: 4,
                        background: "var(--bg-elevated)",
                        padding: "1px 6px",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {isLegMode(tour.mode) ? t(`trips:tours.mode.${tour.mode}`) : tour.mode}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      color: "var(--text-muted)",
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ flex: 1 }}>{tour.tripName}</span>
                    <span>{t("trips:tours.stopCount", { count: tour.stopCount })}</span>
                    <span>{Math.round(tour.distanceKm).toLocaleString()} km</span>
                  </div>
                </div>
              ))
            ))}
        </div>
      )}

      {tourLegend.hasData && (
        <div
          style={{
            position: "absolute",
            bottom: ATTRIBUTION_CLEARANCE,
            right: 12,
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {tourLegend.rows}
        </div>
      )}

      <TourStatusOverlay
        loading={dashboardTours.toursLoading}
        error={dashboardTours.toursLoadError}
        onRetry={dashboardTours.reload}
        t={t}
      />

      {isEmpty && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "6px 14px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 13,
          }}
        >
          {t("dashboard:tourTab.empty")}
        </div>
      )}
    </div>
  );
}

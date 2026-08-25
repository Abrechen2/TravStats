import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useTranslation } from "../../../hooks/useTranslation";
import { cruiseApi } from "../../../lib/api/cruise";
import { logger } from "../../../lib/logger";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
import type { Cruise } from "../../../types/cruise";
import MapContainer3D from "../../MapContainer3D";
import { buildPortFrequencyLayer } from "../modes/buildPortFrequencyLayer";
import { UnifiedActivityPanel } from "../sidebars/UnifiedActivityPanel";
import type { ActivityItem } from "../sidebars/activityItems";
import { DomainDisabledNotice } from "./DomainDisabledNotice";

interface ItineraryDot {
  lat: number;
  lon: number;
  label: string;
  cruiseId: string;
}

export function CruisesTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const { t } = useTranslation(["dashboard"]);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const navigate = useNavigate();

  const loadCruises = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const list = await cruiseApi.list({});
      setCruises(list);
    } catch (err: unknown) {
      logger.error({ err }, "CruisesTab: failed to load cruises");
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectCruise = useCallback(
    (cruise: Cruise): void => {
      setCruiseSelection(cruise);
    },
    [setCruiseSelection]
  );
  const handleCruiseDetails = useCallback(
    (cruise: Cruise): void => {
      navigate(`/cruises/${cruise.id}`);
    },
    [navigate]
  );

  // Domain-gating: never fetch cruise data while the domain is disabled —
  // the tab renders the DomainDisabledNotice stub instead (see below).
  useEffect(() => {
    if (!cruiseEnabled) return;
    void loadCruises();
  }, [cruiseEnabled, loadCruises]);

  // Apply the global year filter to the cruise set. Domain visibility
  // is intentionally NOT applied here — same rationale as FlightsTab:
  // a domain-dedicated tab should keep showing its domain regardless
  // of the cross-domain pill state.
  const filterTime = useDashboardFilterStore((s) => s.time);
  const visibleCruises = useMemo<Cruise[]>(() => {
    if (!filterTime.from && !filterTime.to) return cruises;
    return cruises.filter((c) =>
      // Cruises with a null startDate stay visible — same permissive
      // policy intervalOverlapsRange uses for unparseable dates.
      intervalOverlapsRange(c.startDate ?? "", c.endDate, filterTime.from, filterTime.to)
    );
  }, [cruises, filterTime.from, filterTime.to]);

  const itineraryLayers = useMemo<Layer[]>(() => {
    if (mode !== "itinerary") return [];

    const stops: ItineraryDot[] = visibleCruises.flatMap((c) =>
      c.stops
        .filter((s) => !s.isAtSea && s.port !== null)
        .map((s, index) => ({
          lat: s.port!.lat,
          lon: s.port!.lon,
          label: String(index + 1),
          cruiseId: c.id,
        }))
    );

    if (stops.length === 0) return [];

    return [
      new ScatterplotLayer<ItineraryDot>({
        id: "cruise-itinerary-dots",
        data: stops,
        getPosition: (d) => [d.lon, d.lat],
        getFillColor: [34, 211, 238, 220],
        getRadius: 6,
        radiusUnits: "pixels",
        pickable: true,
      }),
      new TextLayer<ItineraryDot>({
        id: "cruise-itinerary-labels",
        data: stops,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.label,
        getColor: [255, 255, 255],
        getSize: 12,
        background: true,
        backgroundPadding: [3, 2],
        getBackgroundColor: [34, 50, 80, 220],
      }),
    ];
  }, [visibleCruises, mode]);

  const portFrequencyLayers = useMemo<Layer[]>(() => {
    if (mode !== "port-frequency") return [];
    return [buildPortFrequencyLayer(visibleCruises)];
  }, [visibleCruises, mode]);

  // Stable empty-array fallback so DeckGLMap's layer useMemo doesn't see a
  // fresh reference on every render and re-build all layers downstream.
  const extraLayers = useMemo<Layer[]>(
    () =>
      mode === "itinerary" ? itineraryLayers : mode === "port-frequency" ? portFrequencyLayers : [],
    [mode, itineraryLayers, portFrequencyLayers]
  );

  // In port-frequency mode, suppress the internal cruise arcs so the
  // frequency markers are not obscured by route overlays.
  const showInternalCruises = mode !== "port-frequency";

  if (!cruiseEnabled) {
    return <DomainDisabledNotice domain="cruise" />;
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* No `cruiseColorMode` prop: this tab used to pin "perCruise", which
          meant the panel's colour setting never reached this map and the mode
          itself was invisible magic. The mode now comes from the shared cruise
          colour store — "Pro Reise" is one explicit click in the Kreuzfahrten
          appearance section. */}
      <MapContainer3D
        flights={[]}
        visMode={mode === "globe" ? "globe" : "routes"}
        extraLayers={extraLayers}
        showInternalCruises={showInternalCruises}
        cruisesOverride={visibleCruises}
        appearanceDomains={["cruise"]}
      />
      <button
        type="button"
        onClick={() => setSidebarOpen((prev) => !prev)}
        style={{
          position: "absolute",
          top: 12,
          // Shift out of the way when the list panel (320px) is open so it
          // doesn't overlap — matches the Alle tab's toggle behaviour.
          left: sidebarOpen ? 340 : 12,
          zIndex: 30,
          padding: "6px 12px",
          borderRadius: 10,
          background: "rgba(22,27,34,0.85)",
          color: "var(--text-primary)",
          border: "1px solid var(--color-border)",
          cursor: "pointer",
        }}
      >
        ☰ {t("dashboard:sidebar.cruises")}
      </button>
      {/* Same sidebar as every other tab, pinned to this domain. The bespoke
          CruiseListPanel is gone: it never sorted at all and only looked right
          because the API happened to return startDate desc. */}
      <UnifiedActivityPanel
        cruises={visibleCruises}
        lockedKind="cruise"
        title={t("dashboard:sidebar.cruises")}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={(item: ActivityItem) => {
          if ("cruise" in item.payload) handleSelectCruise(item.payload.cruise);
        }}
        onDetails={(item: ActivityItem) => {
          if ("cruise" in item.payload) handleCruiseDetails(item.payload.cruise);
        }}
      />
      {loading && (
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
          {t("dashboard:cruiseTab.loading")}
        </div>
      )}
      {!loading && loadError && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "8px 16px",
            borderRadius: 10,
            background: "rgba(60,20,20,0.92)",
            color: "var(--danger)",
            border: "1px solid var(--danger)",
            fontSize: 13,
          }}
        >
          {t("dashboard:errors.loadCruises")}
        </div>
      )}
      {!loading && !loadError && cruises.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              maxWidth: 420,
              textAlign: "center",
              padding: "28px 32px",
              borderRadius: 16,
              background: "rgba(22,27,34,0.92)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
              ⚓
            </div>
            <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)", fontSize: 18 }}>
              {t("dashboard:cruiseTab.emptyTitle")}
            </h2>
            <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: 14 }}>
              {t("dashboard:cruiseTab.emptyBody")}
            </p>
            <button
              type="button"
              onClick={() => navigate("/cruises")}
              style={{
                padding: "10px 20px",
                background: "var(--accent)",
                color: "#0d1117",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t("dashboard:cruiseTab.emptyCta")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

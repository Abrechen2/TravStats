import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useFlightLookup } from "../../../hooks/useFlightLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { cruiseApi } from "../../../lib/api/cruise";
import { flightsApi } from "../../../lib/api/flights";
import { tripsApi } from "../../../lib/api/trips";
import { logger } from "../../../lib/logger";
import { DOMAINS } from "../../../shared/domains";
import { useCruiseSelectionStore } from "../../../store/cruiseSelectionStore";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import type { Flight, GeoJSONFeature, Trip } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { AllMode } from "../../../types/dashboard";
import { ALL_MODES } from "../../../types/dashboard";
import FlightEditModal from "../../FlightEditModal";
import MapContainer3D, { type MapMode } from "../../MapContainer3D";
import { buildJourneyLayers, groupByTripId } from "../modes/buildJourneyLayers";
import { UnifiedActivityPanel } from "../sidebars/UnifiedActivityPanel";
import type { Layer } from "@deck.gl/core";

// Hex → rgb helper kept local. Small + typed to the DOMAINS registry so
// a bad hex string gets caught at compile time through the [R, G, B] return.
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}
const FLIGHT_RGB = hexToRgb(DOMAINS.flight.color);
const CRUISE_HEX = DOMAINS.cruise.color;

// Maps the dashboard-level AllMode to what MapContainer3D's visMode prop expects.
// "journey" uses extraLayers with showInternalCruises=false so it has full
// control over which trip is rendered.
const ALL_MODE_TO_MAP_MODE: Record<AllMode, MapMode> = {
  overview: "routes",
  heatmap: "heatmap",
  journey: "routes",
  globe: "globe",
};

// Reverse-maps MapMode back to the closest AllMode so the VisModeSelector
// inside MapContainer3D can keep the URL in sync when the user changes mode
// from within the map controls.
const MAP_MODE_TO_ALL_MODE: Partial<Record<MapMode, AllMode>> = {
  routes: "overview",
  heatmap: "heatmap",
  globe: "globe",
};

// Subset of MapMode values offered by the in-map FAB on the Alle tab.
// Globe is cross-domain and only exposed here.
const ALL_TAB_MAP_MODES: readonly MapMode[] = ["routes", "heatmap", "globe"];

function isAllMode(mode: unknown): mode is AllMode {
  return typeof mode === "string" && (ALL_MODES as readonly string[]).includes(mode);
}

export function AllTab(): JSX.Element {
  const { mode, setMode } = useDashboardRoute();
  const { t } = useTranslation(["dashboard"]);
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { lookup, lookupMany } = useFlightLookup();
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const navigate = useNavigate();
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);

  // Global dashboard filter — year populates `time.from/to`, domain
  // pill row toggles flight/cruise visibility on the Alle tab. The pill
  // filter is intersected with the user's enabledDomains: a disabled
  // domain must never surface here, regardless of the pill state (the
  // pill store defaults to AVAILABLE_DOMAINS, not the user's setting).
  const { isEnabled } = useEnabledDomains();
  const filterTime = useDashboardFilterStore((s) => s.time);
  const filterDomains = useDashboardFilterStore((s) => s.domains);
  const flightsVisible = filterDomains.includes("flight") && isEnabled("flight");
  const cruisesVisible = filterDomains.includes("cruise") && isEnabled("cruise");

  // Filter flights by departureTime within the year/time range.
  // Flights without a departureTime stay visible (treat NaN as
  // unbounded, mirroring intervalOverlapsRange's permissive policy).
  const visibleFlights = useMemo<GeoJSONFeature[]>(() => {
    if (!flightsVisible) return [];
    const from = filterTime.from;
    const to = filterTime.to;
    if (!from && !to) return flights;
    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    return flights.filter((f) => {
      const dep = f.properties.departureTime;
      if (!dep) return true;
      const t = Date.parse(dep);
      if (Number.isNaN(t)) return true;
      return t >= fromMs && t <= toMs;
    });
  }, [flights, flightsVisible, filterTime.from, filterTime.to]);

  // Cruises filtered by interval overlap (cruise has start + optional end);
  // hidden entirely when domain is off.
  const visibleCruises = useMemo<Cruise[]>(() => {
    if (!cruisesVisible) return [];
    if (!filterTime.from && !filterTime.to) return cruises;
    return cruises.filter((c) =>
      // Cruises with a null startDate stay visible — same permissive
      // policy intervalOverlapsRange uses for unparseable dates.
      intervalOverlapsRange(c.startDate ?? "", c.endDate, filterTime.from, filterTime.to)
    );
  }, [cruises, cruisesVisible, filterTime.from, filterTime.to]);

  // Map click → selection store. DeckGLMap handles dim/highlight + tooltip.
  const handleFlightClick = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setSelection([f]);
    },
    [lookup, setSelection]
  );
  const handleRouteClick = useCallback(
    (flightIds: string[]): void => {
      const fs = lookupMany(flightIds);
      if (fs.length > 0) setSelection(fs);
    },
    [lookupMany, setSelection]
  );

  // Aktivität-sidebar row wiring.
  const handlePanelFlightSelect = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setSelection([f]);
    },
    [lookup, setSelection]
  );
  const handlePanelFlightDetails = useCallback(
    (flightId: string): void => {
      const f = lookup(flightId);
      if (f) setEditingFlight(f);
    },
    [lookup]
  );
  const handlePanelCruiseSelect = useCallback(
    (cruise: Cruise): void => {
      setCruiseSelection(cruise);
    },
    [setCruiseSelection]
  );
  const handlePanelCruiseDetails = useCallback(
    (cruise: Cruise): void => {
      navigate(`/cruises/${cruise.id}`);
    },
    [navigate]
  );

  const handleFlightSave = useCallback(
    async (id: string, updates: Partial<Flight>): Promise<void> => {
      await flightsApi.update(id, updates);
      // Refresh GeoJSON so the map reflects the edit; full-flight lookup
      // will catch up on the next mount.
      const collection = await flightsApi.getAllGeoJSON();
      setFlights(collection.features);
      setEditingFlight(null);
    },
    []
  );

  // Domain-gating: a disabled domain's data is never fetched, not just
  // hidden at render time.
  useEffect(() => {
    if (!isEnabled("flight")) return;
    let cancelled = false;
    flightsApi
      .getAllGeoJSON()
      .then((collection) => {
        if (!cancelled) setFlights(collection.features);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load GeoJSON", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Cruises are fetched so journey mode can group them with flights by tripId.
  useEffect(() => {
    if (!isEnabled("cruise")) return;
    let cancelled = false;
    cruiseApi
      .list({})
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load cruises", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Trips power the journey-mode selector (label = trip name).
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((list) => {
        if (!cancelled) setTrips(list);
      })
      .catch((err: unknown) => {
        logger.error("AllTab: failed to load trips", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Current dashboard mode narrowed to AllMode; fall back to "overview" if the
  // active mode is from a different tab (shouldn't happen in practice but keeps
  // types sound).
  const allMode: AllMode = isAllMode(mode) ? mode : "overview";
  const visMode = ALL_MODE_TO_MAP_MODE[allMode];

  // Trips that actually have cross-domain data to render, in trip order.
  // The selector below lets the user pick which one journey mode shows.
  const journeyTrips = useMemo<Trip[]>(() => {
    if (allMode !== "journey") return [];
    const groups = groupByTripId(visibleFlights, visibleCruises);
    return trips.filter((trip) => groups[trip.id] !== undefined);
  }, [allMode, visibleFlights, visibleCruises, trips]);

  // Resolve the effective trip: the explicit selection if it still has data,
  // otherwise fall back to the first available trip so the map is never blank
  // when trips exist.
  const effectiveTripId = useMemo<string | null>(() => {
    if (journeyTrips.length === 0) return null;
    if (selectedTripId && journeyTrips.some((tr) => tr.id === selectedTripId)) {
      return selectedTripId;
    }
    return journeyTrips[0].id;
  }, [journeyTrips, selectedTripId]);

  // Journey layers: built only when journey mode is active, for the selected
  // (or first-available) cross-domain trip.
  const journeyLayers = useMemo<Layer[]>(() => {
    if (allMode !== "journey") return [];
    return buildJourneyLayers(visibleFlights, visibleCruises, effectiveTripId);
  }, [allMode, visibleFlights, visibleCruises, effectiveTripId]);

  const handleVisModeChange = useCallback(
    (next: MapMode): void => {
      const mapped = MAP_MODE_TO_ALL_MODE[next];
      if (mapped !== undefined) {
        setMode(mapped);
      }
    },
    [setMode]
  );

  // Toggle + legend share one flex row so they auto-flow without
  // manual left-offset math. The whole row shifts right when the
  // sidebar opens so the chips clear the panel.
  const toggleAndLegend = (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: sidebarOpen ? 340 : 12,
        zIndex: 30,
        display: "flex",
        gap: 8,
        alignItems: "center",
        transition: "left 0.2s ease",
      }}
    >
      <button
        type="button"
        onClick={() => setSidebarOpen((prev) => !prev)}
        style={{
          padding: "6px 12px",
          borderRadius: 10,
          background: "rgba(22,27,34,0.85)",
          color: "var(--text-primary)",
          border: "1px solid var(--color-border)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        ☰ {t("dashboard:sidebar.activity")}
      </button>
      {(flightsVisible || cruisesVisible) && (
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {flightsVisible && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 2,
                  background: DOMAINS.flight.color,
                  borderRadius: 2,
                }}
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("dashboard:sidebar.filters.flight")}
              </span>
            </span>
          )}
          {cruisesVisible && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 2,
                  background: CRUISE_HEX,
                  borderRadius: 2,
                }}
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("dashboard:sidebar.filters.cruise")}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );

  const activityPanel = (
    <UnifiedActivityPanel
      flights={visibleFlights}
      cruises={visibleCruises}
      isOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      onFlightSelect={handlePanelFlightSelect}
      onFlightDetails={handlePanelFlightDetails}
      onCruiseSelect={handlePanelCruiseSelect}
      onCruiseDetails={handlePanelCruiseDetails}
    />
  );

  const editModal = editingFlight !== null && (
    <FlightEditModal
      flight={editingFlight}
      isOpen={true}
      onClose={() => setEditingFlight(null)}
      onSave={handleFlightSave}
    />
  );

  // Journey-mode trip picker, centered at the top. Shows the available
  // cross-domain trips, or a hint when none exist.
  const journeySelector = (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
      }}
    >
      {journeyTrips.length > 0 ? (
        <select
          aria-label={t("dashboard:trips.selectLabel")}
          value={effectiveTripId ?? ""}
          onChange={(e) => setSelectedTripId(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-primary)",
            border: "1px solid var(--color-border)",
            fontSize: 13,
          }}
        >
          {journeyTrips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name || t("dashboard:trips.unnamed")}
            </option>
          ))}
        </select>
      ) : (
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        >
          {t("dashboard:trips.noTrips")}
        </div>
      )}
    </div>
  );

  // Journey mode takes over the map entirely: it injects its own cross-domain
  // layers and suppresses the internal cruise arcs that MapContainer3D would
  // otherwise render, so only the selected trip is shown.
  if (allMode === "journey") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D
          flights={[]}
          visMode="routes"
          onVisModeChange={handleVisModeChange}
          extraLayers={journeyLayers}
          showInternalCruises={false}
          onFlightClick={handleFlightClick}
          onRouteClick={handleRouteClick}
          onFlightOpen={handlePanelFlightDetails}
          onCruiseOpen={(cruiseId) => navigate(`/cruises/${cruiseId}`)}
          flightRouteColor={FLIGHT_RGB}
          availableModes={ALL_TAB_MAP_MODES}
          cruisesOverride={visibleCruises}
          // journey renders in "routes" visMode but is a synthetic mode not
          // in the FAB set — hide the FAB so it can't show "Routes" as active
          // (contradicting the toolbar) or drop the user out of journey.
          hideVisModeSelector
          hideInfoPill
        />
        {toggleAndLegend}
        {journeySelector}
        {activityPanel}
        {editModal}
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={visibleFlights}
        visMode={visMode}
        onVisModeChange={handleVisModeChange}
        flightRouteColor={FLIGHT_RGB}
        statusTwoTone
        cruiseColorMode="status"
        onFlightClick={handleFlightClick}
        onRouteClick={handleRouteClick}
        onFlightOpen={handlePanelFlightDetails}
        onCruiseOpen={(cruiseId) => navigate(`/cruises/${cruiseId}`)}
        availableModes={ALL_TAB_MAP_MODES}
        cruisesOverride={visibleCruises}
        hideInfoPill
      />
      {toggleAndLegend}
      {activityPanel}
      {editModal}
    </div>
  );
}

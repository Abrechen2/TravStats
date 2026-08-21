import { useEffect, useState, useCallback, useMemo } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useFlightLookup } from "../../../hooks/useFlightLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { useFlightSelectionStore } from "../../../store/flightSelectionStore";
import { useToastStore } from "../../../store/toastStore";
import type { Flight, FlightInput, GeoJSONFeature } from "../../../types";
import type { FlightMode } from "../../../types/dashboard";
import FlightEditModal from "../../FlightEditModal";
import { FlightPanel } from "../../FlightPanel";
import MapContainer3D, { type MapMode } from "../../MapContainer3D";
import SimplifiedFlightFormV2 from "../../SimplifiedFlightFormV2";
import SpecialFlightModal from "../../SpecialFlightModal";
import type { FlightSubmitOptions } from "../../FlightForm/useFlightForm";
import { buildStatsMapLayer } from "../modes/buildStatsMapLayer";
import { DomainDisabledNotice } from "./DomainDisabledNotice";

// Maps the dashboard-level FlightMode to what MapContainer3D's visMode prop expects.
// "stats-map" is delivered via extraLayers — the map itself renders in "routes" mode.
const FLIGHT_MODE_TO_MAP_MODE: Record<FlightMode, MapMode> = {
  routes: "routes",
  heatmap: "heatmap",
  "stats-map": "routes",
  trips: "trips",
  globe: "globe",
};

// Convert nullable DB columns to undefined so Zod .optional() accepts them
// when re-creating a flight (duplicate). See project memory note on
// Zod + nullable+optional.
function nullToUndef<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

export function FlightsTab(): JSX.Element {
  const { t } = useTranslation(["dashboard", "common", "flights"]);
  const navigate = useNavigate();
  const { mode } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const flightEnabled = isEnabled("flight");
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);
  const [structuredFlights, setStructuredFlights] = useState<Flight[]>([]);
  const [structuredTotal, setStructuredTotal] = useState(0);
  // Guards the empty state (#262): only shown once the first load settled,
  // never while the counts are still the initial zeros.
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingSpecialFlight, setEditingSpecialFlight] = useState<Flight | null>(null);
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const { lookup, lookupMany } = useFlightLookup();
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const detailMode = useFlightSelectionStore((s) => s.detailMode);
  const addToast = useToastStore((s) => s.addToast);

  // The "Route-Details" / "Trip-Details" buttons in the map tooltip flip
  // detailMode in the store but render their content inside <FlightPanel>.
  // If the sidebar is closed at the moment the user clicks, the click
  // would silently update the store and look like nothing happened —
  // auto-open the sidebar so the details actually show up.
  useEffect(() => {
    if (detailMode !== null) setSidebarOpen(true);
  }, [detailMode]);

  const loadGeoJSON = useCallback(async (): Promise<void> => {
    try {
      const collection = await flightsApi.getAllGeoJSON();
      setFlights(collection.features);
    } catch (err: unknown) {
      logger.error("FlightsTab: failed to load GeoJSON", err);
    }
  }, []);

  const loadStructured = useCallback(async (): Promise<void> => {
    try {
      const result = await flightsApi.getAll({ limit: 500 });
      setStructuredFlights(result.flights);
      setStructuredTotal(result.total);
    } catch (err: unknown) {
      logger.error("FlightsTab: failed to load structured flights", err);
    }
  }, []);

  // Domain-gating: never fetch flight data while the domain is disabled —
  // the tab renders the DomainDisabledNotice stub instead (see below).
  useEffect(() => {
    if (!flightEnabled) return;
    let cancelled = false;
    void Promise.all([loadGeoJSON(), loadStructured()]).then(() => {
      if (cancelled) return;
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [flightEnabled, loadGeoJSON, loadStructured]);

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([loadGeoJSON(), loadStructured()]);
  }, [loadGeoJSON, loadStructured]);

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

  // FlightPanel callbacks.
  const handleEdit = useCallback((flight: Flight): void => {
    setEditingFlight(flight);
  }, []);

  const handleDuplicate = useCallback(
    async (flight: Flight): Promise<void> => {
      const depAirport = {
        iata: flight.depIata,
        icao: flight.depIcao,
        name: flight.depName,
        lat: flight.depLat,
        lon: flight.depLon,
      };
      const arrAirport = {
        iata: flight.arrIata,
        icao: flight.arrIcao,
        name: flight.arrName,
        lat: flight.arrLat,
        lon: flight.arrLon,
      };
      const input: FlightInput = {
        airline: nullToUndef(flight.airline),
        operatingAirline: nullToUndef(flight.operatingAirline),
        flightNumber: nullToUndef(flight.flightNumber),
        aircraft: nullToUndef(flight.aircraft),
        departure: depAirport,
        arrival: arrAirport,
        status: "duplicated",
        category: nullToUndef(flight.category),
        tags: flight.tags ?? undefined,
        companions: flight.companions ?? undefined,
        notes: nullToUndef(flight.notes),
      };
      try {
        const created = await flightsApi.create(input, { force: true });
        addToast("success", t("flights:table.toast.duplicated"));
        await refreshAll();
        setEditingFlight(created);
      } catch (err: unknown) {
        logger.error("FlightsTab: duplicate failed", err);
        addToast("error", t("flights:table.toast.duplicateFailed"));
      }
    },
    [addToast, refreshAll, t]
  );

  const handleDelete = useCallback(
    async (flightId: string): Promise<void> => {
      try {
        await flightsApi.delete(flightId);
        addToast("success", t("flights:table.toast.deleted"));
        await refreshAll();
      } catch (err: unknown) {
        logger.error("FlightsTab: delete failed", err);
        addToast("error", t("dashboard:errors.deleteFlight"));
      }
    },
    [addToast, refreshAll, t]
  );

  const handleAdd = useCallback((): void => {
    setShowAddFlight(true);
  }, []);

  const handleAddSubmit = useCallback(
    async (flight: FlightInput, opts?: FlightSubmitOptions): Promise<Flight> => {
      try {
        const created = await flightsApi.create(flight, opts);
        addToast("success", t("flights:table.toast.updated"));
        setShowAddFlight(false);
        await refreshAll();
        // Flows back into the form's post-create trip assignment (#199).
        return created;
      } catch (err: unknown) {
        logger.error("FlightsTab: add failed", err);
        throw err;
      }
    },
    [addToast, refreshAll, t]
  );

  const handleFlightSave = useCallback(
    async (id: string, updates: Partial<FlightInput>): Promise<void> => {
      await flightsApi.update(id, updates);
      await refreshAll();
      setEditingFlight(null);
    },
    [refreshAll]
  );

  // Current dashboard mode narrowed to FlightMode; fall back to "routes" if the
  // active mode is from a different tab (shouldn't happen in practice but keeps
  // types sound).
  const flightMode = (mode in FLIGHT_MODE_TO_MAP_MODE ? mode : "routes") as FlightMode;
  const visMode = FLIGHT_MODE_TO_MAP_MODE[flightMode];

  // Apply the global year filter to the flight set. Domain visibility
  // is intentionally NOT applied here — this tab is dedicated to
  // flights, the user already opened it, so hiding everything when the
  // domain pill is off would be a worse UX than ignoring the pill on
  // a dedicated tab.
  const filterTime = useDashboardFilterStore((s) => s.time);
  const visibleFlights = useMemo<GeoJSONFeature[]>(() => {
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
  }, [flights, filterTime.from, filterTime.to]);

  // Build airport-frequency markers when stats-map mode is active.
  const statsMapLayers = useMemo<Layer[]>(() => {
    if (flightMode !== "stats-map") return [];
    return [buildStatsMapLayer(visibleFlights)];
  }, [flightMode, visibleFlights]);

  if (!flightEnabled) {
    return <DomainDisabledNotice domain="flight" />;
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={flightMode === "stats-map" ? [] : visibleFlights}
        visMode={visMode}
        extraLayers={statsMapLayers}
        showInternalCruises={false}
        appearanceDomains={["flight"]}
        onFlightClick={handleFlightClick}
        onRouteClick={handleRouteClick}
        onFlightOpen={(flightId) => {
          const f = lookup(flightId);
          if (f) setEditingFlight(f);
        }}
        hideInfoPill
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
        ☰ {t("dashboard:sidebar.flights")}
      </button>
      <FlightPanel
        flights={structuredFlights}
        totalCount={structuredTotal}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onEdit={handleEdit}
        onDuplicate={(f) => void handleDuplicate(f)}
        onDelete={(id) => void handleDelete(id)}
        onAddFlight={handleAdd}
        allFlights={structuredFlights}
      />
      {editingFlight && (
        <FlightEditModal
          flight={editingFlight}
          isOpen={true}
          onClose={() => setEditingFlight(null)}
          onSave={handleFlightSave}
        />
      )}
      {showAddFlight && (
        <SimplifiedFlightFormV2
          onSubmit={handleAddSubmit}
          onCancel={() => setShowAddFlight(false)}
          onPickSpecialFlight={() => {
            setShowAddFlight(false);
            setShowSpecialModal(true);
          }}
        />
      )}
      {loaded && structuredTotal === 0 && flights.length === 0 && (
        // Empty state (#262), modeled on the cruises tab: what this tab
        // shows, plus the two ways to get a first flight in.
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
              ✈️
            </div>
            <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)", fontSize: 18 }}>
              {t("dashboard:flightTab.emptyTitle")}
            </h2>
            <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: 14 }}>
              {t("dashboard:flightTab.emptyBody")}
            </p>
            <button
              type="button"
              onClick={() => navigate("/flights")}
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
              {t("dashboard:flightTab.emptyCta")}
            </button>
          </div>
        </div>
      )}
      <SpecialFlightModal
        isOpen={showSpecialModal || editingSpecialFlight !== null}
        flight={editingSpecialFlight}
        onClose={() => {
          setShowSpecialModal(false);
          setEditingSpecialFlight(null);
        }}
        onSaved={() => {
          setShowSpecialModal(false);
          setEditingSpecialFlight(null);
          void refreshAll();
        }}
      />
    </div>
  );
}

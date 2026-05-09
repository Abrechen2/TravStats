import { useEffect, useState, useCallback, useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useFlightLookup } from "../../../hooks/useFlightLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { flightsApi } from "../../../lib/api/flights";
import { logger } from "../../../lib/logger";
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

// Maps the dashboard-level FlightMode to what MapContainer3D's visMode prop expects.
// "stats-map" is delivered via extraLayers — the map itself renders in "routes" mode.
const FLIGHT_MODE_TO_MAP_MODE: Record<FlightMode, MapMode> = {
  routes: "routes",
  heatmap: "heatmap",
  "stats-map": "routes",
  trips: "trips",
};

// Reverse-maps MapMode back to the closest FlightMode so the VisModeSelector
// inside MapContainer3D can keep the URL in sync when the user changes mode
// from within the map controls.
const MAP_MODE_TO_FLIGHT_MODE: Partial<Record<MapMode, FlightMode>> = {
  routes: "routes",
  heatmap: "heatmap",
  trips: "trips",
};

// Convert nullable DB columns to undefined so Zod .optional() accepts them
// when re-creating a flight (duplicate). See project memory note on
// Zod + nullable+optional.
function nullToUndef<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

export function FlightsTab(): JSX.Element {
  const { t } = useTranslation(["dashboard", "common", "flights"]);
  const { mode, setMode } = useDashboardRoute();
  const [flights, setFlights] = useState<GeoJSONFeature[]>([]);
  const [structuredFlights, setStructuredFlights] = useState<Flight[]>([]);
  const [structuredTotal, setStructuredTotal] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingSpecialFlight, setEditingSpecialFlight] = useState<Flight | null>(null);
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const { lookup, lookupMany } = useFlightLookup();
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const addToast = useToastStore((s) => s.addToast);

  const loadGeoJSON = useCallback(async (): Promise<void> => {
    try {
      const collection = await flightsApi.getGeoJSON();
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadGeoJSON(), loadStructured()]).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadGeoJSON, loadStructured]);

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
    async (flight: FlightInput, opts?: FlightSubmitOptions): Promise<void> => {
      try {
        await flightsApi.create(flight, opts);
        addToast("success", t("flights:table.toast.updated"));
        setShowAddFlight(false);
        await refreshAll();
      } catch (err: unknown) {
        logger.error("FlightsTab: add failed", err);
        throw err;
      }
    },
    [addToast, refreshAll, t]
  );

  const handleFlightSave = useCallback(
    async (id: string, updates: Partial<Flight>): Promise<void> => {
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

  const handleVisModeChange = useCallback(
    (next: MapMode): void => {
      const mapped = MAP_MODE_TO_FLIGHT_MODE[next];
      if (mapped !== undefined) {
        setMode(mapped);
      }
    },
    [setMode]
  );

  // Build airport-frequency markers when stats-map mode is active.
  const statsMapLayers = useMemo<Layer[]>(() => {
    if (flightMode !== "stats-map") return [];
    return [buildStatsMapLayer(flights)];
  }, [flightMode, flights]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={flightMode === "stats-map" ? [] : flights}
        visMode={visMode}
        onVisModeChange={handleVisModeChange}
        extraLayers={statsMapLayers}
        showInternalCruises={false}
        onFlightClick={handleFlightClick}
        onRouteClick={handleRouteClick}
        onFlightOpen={(flightId) => {
          const f = lookup(flightId);
          if (f) setEditingFlight(f);
        }}
      />
      <button
        type="button"
        onClick={() => setSidebarOpen((prev) => !prev)}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
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

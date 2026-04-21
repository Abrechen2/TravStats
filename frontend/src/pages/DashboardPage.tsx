import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import type { VisMode } from "../types/visMode";

import { flightsApi } from "../lib/api";
import { cruiseApi } from "../lib/api/cruise";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import MapContainer3D from "../components/MapContainer3D";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import FlightEditModal from "../components/FlightEditModal";
import Stats from "../components/Stats";
import Filters from "../components/Filters";
import ErrorBoundary from "../components/ErrorBoundary";
import NavigationBar from "../components/NavigationBar";
import AchievementPopup from "../components/AchievementPopup";
import HelpIcon from "../components/Help/HelpIcon";
import { useClickOutside } from "../hooks/useClickOutside";
import type { Flight, FlightInput, FlightFilters, GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { API_LIMITS } from "../lib/constants";
import { toCsv, escapeXml, downloadBlob } from "../lib/export";
import { motion, AnimatePresence } from "framer-motion";
import { FlightPanel } from "../components/FlightPanel";
// jsPDF and autoTable are dynamically imported when needed to reduce bundle size

export default function DashboardPage(): JSX.Element {
  const { t } = useTranslation(["dashboard", "common", "flights", "training"]);
  const { isEnabled, enabled } = useEnabledDomains();
  const [allFlights, setFlights] = useState<Flight[]>([]); // Filtered flights for map (not directly rendered)
  const [recentFlights, setRecentFlights] = useState<Flight[]>([]); // Unfiltered recent flights for sidebar
  const [totalFlightsCount, setTotalFlightsCount] = useState(0); // Total number of all flights
  const [cruises, setCruises] = useState<Cruise[]>([]); // Cruise list for the dashboard pill (only loaded when the cruise domain is enabled)
  const [geoFlights, setGeoFlights] = useState<GeoJSONFeature[]>([]);
  const [showFlightForm, setShowFlightForm] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [duplicatingFlight, setDuplicatingFlight] = useState<Flight | null>(null);
  const [filters, setFilters] = useState<FlightFilters>({});
  const [, setLoadingMap] = useState(true); // Loading indicator for map
  const [, setLoadingRecent] = useState(true);
  const [visMode, setVisMode] = useState<VisMode>("routes");
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const location = useLocation();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const detailMode = useFlightSelectionStore((s) => s.detailMode);

  // Auto-open sidebar when route/trip details are requested
  useEffect(() => {
    if (detailMode) setLeftOpen(true);
  }, [detailMode]);
  // On mount: read location.state to set initial visMode and activeTripId (e.g. from "Show on Map")
  useEffect(() => {
    const state = location.state as { visMode?: string; tripId?: string } | null;
    if (state?.visMode) {
      setVisMode(state.visMode as VisMode);
    }
    if (state?.tripId) {
      setActiveTripId(state.tripId);
    }
  }, []); // intentionally empty — only run on mount to read initial navigation state

  // Auto-select all flights of the highlighted trip so airport rings + tooltip appear automatically.
  // Only fires when a specific trip is active in trip-routes mode (e.g. from "Show on Map").
  useEffect(() => {
    if (visMode !== "trip-routes" || !activeTripId) return;
    const tripFlights = allFlights.filter((f) => f.tripId === activeTripId);
    if (tripFlights.length > 0) {
      useFlightSelectionStore.getState().setSelection(tripFlights);
    }
  }, [activeTripId, visMode, allFlights]);

  const addToast = useToastStore((state) => state.addToast);
  const [newAchievements, setNewAchievements] = useState<import("../types").UserAchievement[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [, setImporting] = useState(false);

  // Close export menu when clicking outside
  useClickOutside(exportMenuRef, () => {
    if (showExportMenu) {
      setShowExportMenu(false);
    }
  });

  // Load recent flights and total count (unfiltered) once on mount
  const loadRecentFlights = useCallback(async () => {
    try {
      setLoadingRecent(true);
      const data = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(data.flights);
      setTotalFlightsCount(data.total); // Store total count
    } catch (error) {
      logger.error("Failed to load recent flights:", error);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    loadRecentFlights();
  }, [loadRecentFlights]);

  // Cruise list for the top-left pill. Skipped entirely when the domain
  // is off so we never spend a request on it.
  useEffect(() => {
    if (!isEnabled("cruise")) {
      setCruises([]);
      return;
    }
    let cancelled = false;
    cruiseApi
      .list({ sort: "date" })
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((error) => {
        logger.error("Failed to load cruises for dashboard pill:", error);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Derive the "next upcoming cruise" label once per cruises change.
  const nextUpcomingCruise = ((): Cruise | null => {
    const nowMs = Date.now();
    let best: { cruise: Cruise; startMs: number } | null = null;
    for (const c of cruises) {
      if (c.status !== "scheduled") continue;
      if (!c.startDate) continue;
      const startMs = Date.parse(c.startDate);
      if (Number.isNaN(startMs)) continue;
      if (startMs < nowMs) continue;
      if (best === null || startMs < best.startMs) best = { cruise: c, startMs };
    }
    return best?.cruise ?? null;
  })();

  const loadFlights = useCallback(async () => {
    try {
      setLoadingMap(true);
      // minRouteCount is a map-only filter — not applied to API queries
      const { minRouteCount: _mapOnly, ...apiFilters } = filters;
      void _mapOnly;

      // Load all flights by pagination (with safety limit)
      const MAX_PAGES = 100;
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await flightsApi.getAll({ ...apiFilters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

        // If we received fewer flights than the limit, we've reached the end
        if (data.flights.length < limit) {
          break;
        }

        offset += limit;
      }

      // Load all GeoJSON features by pagination (with safety limit)
      let allGeoFeatures: GeoJSONFeature[] = [];
      offset = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const geoData = await flightsApi.getGeoJSON({ ...apiFilters, limit, offset });
        allGeoFeatures = [...allGeoFeatures, ...geoData.features];

        // If we received fewer features than the limit, we've reached the end
        if (geoData.features.length < limit) {
          break;
        }

        offset += limit;
      }

      setFlights(allFlights);
      setGeoFlights(allGeoFeatures);
    } catch (error) {
      logger.error("Failed to load flights:", error);
    } finally {
      setLoadingMap(false);
    }
  }, [filters]);

  useEffect(() => {
    loadFlights();
  }, [loadFlights]);

  const handleAddFlight = async (flight: FlightInput, force = false, hasMoreFlights = false) => {
    try {
      const result = (await flightsApi.create(flight, force)) as Flight & {
        newAchievements?: import("../types").UserAchievement[];
      };
      if (!hasMoreFlights) {
        setShowFlightForm(false);
      }
      loadFlights();

      // Reload recent flights and total count for sidebar
      const recentData = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(recentData.flights);
      setTotalFlightsCount(recentData.total);

      // Show achievement popup if new achievements were unlocked
      if (result.newAchievements && result.newAchievements.length > 0) {
        setNewAchievements(result.newAchievements);
      }
    } catch (error) {
      logger.error("Failed to add flight:", error);
      addToast("error", t("dashboard:errors.addFlight"));
      throw error;
    }
  };

  const handleBatchComplete = async (
    batchAchievements?: import("../types").UserAchievement[]
  ): Promise<void> => {
    setShowFlightForm(false);

    // Refresh flight data after batch import
    loadFlights();
    const recentData = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
    setRecentFlights(recentData.flights);
    setTotalFlightsCount(recentData.total);

    // Show achievement popup if new achievements were unlocked
    if (batchAchievements && batchAchievements.length > 0) {
      setNewAchievements(batchAchievements);
    }
  };

  const handleUpdateFlight = async (id: string, updates: Partial<Flight>) => {
    try {
      const result = (await flightsApi.update(id, updates)) as Flight & {
        newAchievements?: import("../types").UserAchievement[];
      };
      setEditingFlight(null);
      loadFlights();

      // Reload recent flights and total count for sidebar
      const recentData = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(recentData.flights);
      setTotalFlightsCount(recentData.total);

      // Show achievement popup if new achievements were unlocked
      if (result.newAchievements && result.newAchievements.length > 0) {
        setNewAchievements(result.newAchievements);
      }
    } catch (error) {
      logger.error("Failed to update flight:", error);
      addToast("error", t("dashboard:errors.updateFlight"));
      throw error;
    }
  };

  const handleDeleteFlight = useCallback(
    async (flightId: string) => {
      // Optimistically remove from UI immediately
      setRecentFlights((prev) => prev.filter((f) => f.id !== flightId));
      setFlights((prev) => prev.filter((f) => f.id !== flightId));
      setGeoFlights((prev) => prev.filter((f) => f.properties.id !== flightId));
      setTotalFlightsCount((prev) => prev - 1);

      try {
        await flightsApi.delete(flightId);
        addToast("success", t("dashboard:success.flightDeleted"));
        loadFlights();
        const recentData = await flightsApi.getAll({
          limit: API_LIMITS.RECENT_FLIGHTS,
          offset: 0,
        });
        setRecentFlights(recentData.flights);
        setTotalFlightsCount(recentData.total);
      } catch (error) {
        logger.error("Failed to delete flight:", error);
        addToast("error", t("dashboard:errors.deleteFlight"));
        // Reload everything to restore the flight in all views (sidebar + map)
        loadFlights();
        const recentData = await flightsApi.getAll({
          limit: API_LIMITS.RECENT_FLIGHTS,
          offset: 0,
        });
        setRecentFlights(recentData.flights);
        setTotalFlightsCount(recentData.total);
      }
    },
    [addToast, loadFlights, t]
  );

  const handleDuplicateFlight = useCallback((flight: Flight): void => {
    setDuplicatingFlight(flight);
  }, []);

  const executeDuplicate = useCallback(
    async (flight: Flight, mode: "outbound" | "return"): Promise<void> => {
      setDuplicatingFlight(null);
      try {
        const isReturn = mode === "return";
        const input: FlightInput = {
          airline: flight.airline || undefined,
          flightNumber: isReturn ? undefined : flight.flightNumber || undefined,
          callsign: flight.callsign || undefined,
          aircraft: flight.aircraft || undefined,
          departure: isReturn
            ? {
                iata: flight.arrIata,
                icao: flight.arrIcao,
                name: flight.arrName,
                lat: flight.arrLat,
                lon: flight.arrLon,
              }
            : {
                iata: flight.depIata,
                icao: flight.depIcao,
                name: flight.depName,
                lat: flight.depLat,
                lon: flight.depLon,
              },
          arrival: isReturn
            ? {
                iata: flight.depIata,
                icao: flight.depIcao,
                name: flight.depName,
                lat: flight.depLat,
                lon: flight.depLon,
              }
            : {
                iata: flight.arrIata,
                icao: flight.arrIcao,
                name: flight.arrName,
                lat: flight.arrLat,
                lon: flight.arrLon,
              },
          departureTime: flight.departureTime || undefined,
          arrivalTime: flight.arrivalTime || undefined,
          status: "duplicated",
          seatClass: flight.seatClass || undefined,
          category: flight.category || undefined,
          tags: flight.tags?.length ? flight.tags : undefined,
          companions: flight.companions?.length ? flight.companions : undefined,
        };
        await flightsApi.create(input, true);
        const recentData = await flightsApi.getAll({
          limit: API_LIMITS.RECENT_FLIGHTS,
          offset: 0,
        });
        setRecentFlights(recentData.flights);
        setTotalFlightsCount(recentData.total);
        loadFlights();
        addToast("success", t("dashboard:success.flightDuplicated"));
      } catch (error) {
        logger.error("Failed to duplicate flight:", error);
        addToast("error", t("dashboard:errors.duplicateFlight"));
      }
    },
    [addToast, loadFlights, t]
  );

  const handleFilterChange = (newFilters: FlightFilters) => {
    setFilters(newFilters);
  };

  const handleExport = async (format: "csv" | "geojson" | "pdf" | "kml") => {
    try {
      if (format === "geojson") {
        // minRouteCount is a map-only filter — not applied to API queries
        const { minRouteCount: _mapOnly, ...apiFilters } = filters;
        void _mapOnly;
        const geoData = await flightsApi.getGeoJSON(apiFilters);
        const blob = new Blob([JSON.stringify(geoData, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `flights-${new Date().toISOString()}.geojson`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // CSV/PDF/KML export
        // minRouteCount is a map-only filter — not applied to API queries
        const { minRouteCount: _mapOnly2, ...apiFilters } = filters;
        void _mapOnly2;
        const data = await flightsApi.getAll(apiFilters);

        // Build rows with proper structure (not pre-joined)
        const rowsData = [
          [
            "Airline",
            "Flight Number",
            "Departure Airport",
            "Arrival Airport",
            "Departure Time",
            "Arrival Time",
            "Status",
            "Aircraft",
            "Category",
            "Tags",
            "Price",
            "Currency",
            "Taxes",
            "Fees",
          ],
          ...data.flights.map((f) => [
            f.airline,
            f.flightNumber,
            f.depIata || f.depIcao || "",
            f.arrIata || f.arrIcao || "",
            f.departureTime,
            f.arrivalTime,
            f.status,
            f.aircraft || "",
            f.category || "",
            f.tags?.join("|") || "",
            f.price ?? "",
            f.currency || "",
            f.taxes ?? "",
            f.fees ?? "",
          ]),
        ];

        if (format === "csv") {
          // Use proper CSV escaping
          const csvContent = toCsv(rowsData);
          const blob = new Blob([csvContent], { type: "text/csv" });
          downloadBlob(blob, `flights-${new Date().toISOString()}.csv`);
        } else if (format === "pdf") {
          // Generate real PDF using jsPDF (dynamically imported)
          const { jsPDF } = await import("jspdf");
          const { default: autoTable } = await import("jspdf-autotable");
          const doc = new jsPDF("landscape");

          // Add title
          doc.setFontSize(18);
          doc.text(t("dashboard:pdf.title"), 14, 15);

          // Add export date and total flights
          doc.setFontSize(10);
          doc.text(`${t("dashboard:pdf.exported")} ${new Date().toLocaleString()}`, 14, 22);
          doc.text(`${t("dashboard:pdf.totalFlights")} ${data.flights.length}`, 14, 27);

          // Prepare table data
          const tableData = rowsData.slice(1).map((row) => row.map((cell) => String(cell || "")));

          // Generate table
          autoTable(doc, {
            head: [rowsData[0].map((h) => String(h))],
            body: tableData,
            startY: 32,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            margin: { top: 32, left: 14, right: 14 },
            tableWidth: "auto",
          });

          // Save PDF
          doc.save(`flights-${new Date().toISOString()}.pdf`);
        } else if (format === "kml") {
          const placemarks = data.flights
            .map((f) => {
              if (!f.depLat || !f.depLon || !f.arrLat || !f.arrLon) return "";
              const name = escapeXml(`${f.airline || ""} ${f.flightNumber || ""}`.trim());
              const desc = escapeXml(
                `${f.depIata || f.depIcao || ""} -> ${f.arrIata || f.arrIcao || ""}`
              );
              return `
                <Placemark>
                  <name>${name}</name>
                  <description>${desc}</description>
                  <LineString>
                    <coordinates>
                      ${f.depLon},${f.depLat},0
                      ${f.arrLon},${f.arrLat},0
                    </coordinates>
                  </LineString>
                </Placemark>
              `;
            })
            .join("\n");
          const kml = `<?xml version="1.0" encoding="UTF-8"?>
            <kml xmlns="http://www.opengis.net/kml/2.2">
              <Document>
                <name>TravStats Flights</name>
                ${placemarks}
              </Document>
            </kml>`;
          const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
          downloadBlob(blob, `flights-${new Date().toISOString()}.kml`);
        }
      }
    } catch (error) {
      logger.error("Failed to export:", error);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result;
        if (!content || typeof content !== "string") {
          addToast("error", t("dashboard:errors.importFailed"));
          return;
        }

        let parsed: Record<string, string>[] = [];
        if (file.name.endsWith(".json")) {
          parsed = JSON.parse(content) as Record<string, string>[];
        } else {
          // naive CSV parser
          const lines = content.split("\n").filter(Boolean);
          const header = lines.shift()?.split(",") || [];
          parsed = lines.map((line) => {
            const cells = line.split(",");
            return header.reduce(
              (acc, key, idx) => {
                acc[key.trim()] = cells[idx]?.trim();
                return acc;
              },
              {} as Record<string, string>
            );
          });
        }

        if (parsed.length === 0) {
          addToast("warning", t("common:messages.noData"));
          return;
        }

        // Convert parsed data to FlightInput format and import
        let successCount = 0;
        let errorCount = 0;

        for (const item of parsed) {
          try {
            // Map CSV/JSON fields to FlightInput
            const flightInput: FlightInput = {
              airline: item.airline || item.Airline || "",
              flightNumber: item.flightNumber || item["Flight Number"] || item.flight_number || "",
              departure: {
                iata: item.depIata || item["Departure Airport"] || item.departure_airport || "",
                icao: item.depIcao || item.departure_icao || "",
                name: item.depName || item.departure_name || "",
                lat: Number(item.depLat || item.departure_lat || 0),
                lon: Number(item.depLon || item.departure_lon || 0),
              },
              arrival: {
                iata: item.arrIata || item["Arrival Airport"] || item.arrival_airport || "",
                icao: item.arrIcao || item.arrival_icao || "",
                name: item.arrName || item.arrival_name || "",
                lat: Number(item.arrLat || item.arrival_lat || 0),
                lon: Number(item.arrLon || item.arrival_lon || 0),
              },
              departureTime:
                item.departureTime || item["Departure Time"] || item.departure_time || "",
              arrivalTime: item.arrivalTime || item["Arrival Time"] || item.arrival_time || "",
              status: (item.status || item.Status || "flown") as
                | "scheduled"
                | "flown"
                | "cancelled",
              aircraft: item.aircraft || item.Aircraft || "",
            };

            await flightsApi.create(flightInput);
            successCount++;
          } catch (err) {
            errorCount++;
            logger.error("Failed to import flight:", err);
          }
        }

        if (successCount > 0 && errorCount > 0) {
          addToast(
            "warning",
            t("dashboard:errors.importPartial", {
              success: successCount,
              total: parsed.length,
              errors: errorCount,
            })
          );
          loadRecentFlights();
          loadFlights();
        } else if (successCount > 0) {
          addToast("success", t("dashboard:success.flightAdded"));
          // Reload flights
          loadRecentFlights();
          loadFlights();
        } else {
          addToast("error", t("dashboard:errors.importFailed"));
        }
      } catch (err) {
        logger.error("Import failed:", err);
        addToast("error", t("dashboard:errors.importFailed"));
      } finally {
        setImporting(false);
        if (importInputRef.current) {
          importInputRef.current.value = "";
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <input
        type="file"
        accept=".csv,.json"
        ref={importInputRef}
        onChange={handleImportFile}
        className="hidden"
      />
      <NavigationBar />

      {/* Achievement Popup */}
      {newAchievements.length > 0 && (
        <AchievementPopup achievements={newAchievements} onClose={() => setNewAchievements([])} />
      )}

      {!isEnabled("flight") && enabled.length === 0 && (
        <div
          className="flex flex-col items-center justify-center min-h-[60vh] gap-3"
          style={{ color: "var(--text-muted)" }}
        >
          <p>{t("dashboard.empty.noDomains") || "No tracking modules enabled."}</p>
          <Link to="/settings" className="text-sm underline" style={{ color: "var(--accent)" }}>
            {t("dashboard.empty.openSettings") || "Open Settings → Modules"}
          </Link>
        </div>
      )}

      {!isEnabled("flight") && enabled.length > 0 && (
        <div
          className="flex flex-col items-center justify-center min-h-[60vh] gap-3"
          style={{ color: "var(--text-muted)" }}
        >
          <p>Flight dashboard hidden because Flights module is disabled.</p>
          <Link to="/settings" className="text-sm underline" style={{ color: "var(--accent)" }}>
            {t("dashboard.empty.openSettings") || "Open Settings → Modules"}
          </Link>
        </div>
      )}

      {isEnabled("flight") && (
        <>
          {/* Main area: map fills everything */}
          <div className="flex-1 relative overflow-hidden">
            {/* Map Layer */}
            <div className="absolute inset-0">
              <ErrorBoundary
                fallback={
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("dashboard:mapUnavailable")}
                  </div>
                }
              >
                <MapContainer3D
                  flights={geoFlights}
                  flightList={allFlights}
                  visMode={visMode}
                  onVisModeChange={setVisMode}
                  minRouteCount={filters.minRouteCount ?? 1}
                  onFlightClick={(id) => {
                    const flight =
                      allFlights.find((f) => f.id === id) ?? recentFlights.find((f) => f.id === id);
                    if (flight) useFlightSelectionStore.getState().setSelection([flight]);
                  }}
                  onRouteClick={(ids) => {
                    const routeFlights = ids
                      .map(
                        (id) =>
                          allFlights.find((f) => f.id === id) ??
                          recentFlights.find((f) => f.id === id)
                      )
                      .filter((f): f is Flight => f !== undefined);
                    if (routeFlights.length > 0)
                      useFlightSelectionStore.getState().setSelection(routeFlights);
                  }}
                  onEdit={(flight) => setEditingFlight(flight)}
                  activeTripId={activeTripId}
                  onResetTrip={() => {
                    setActiveTripId(null);
                    setVisMode("routes");
                  }}
                  filterSlot={
                    visMode !== "trips" ? (
                      <Filters onFilterChange={handleFilterChange} />
                    ) : undefined
                  }
                />
              </ErrorBoundary>
            </div>

            {/* Empty state — shown when user has no flights yet */}
            {totalFlightsCount === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                <div
                  className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl text-center pointer-events-auto"
                  style={{
                    background: "rgba(15,23,42,0.85)",
                    border: "1px solid var(--color-border)",
                    backdropFilter: "blur(12px)",
                    maxWidth: "340px",
                  }}
                >
                  <span style={{ fontSize: "2.5rem" }}>✈️</span>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("dashboard:noFlights")}
                  </p>
                  <button
                    onClick={() => setShowFlightForm(true)}
                    className="btn-primary text-sm px-4 py-2"
                  >
                    {t("dashboard:addFlight")}
                  </button>
                </div>
              </div>
            )}

            {/* Floating Top-Left Controls: sidebar toggles */}
            <div className="absolute top-3 left-3 z-20 flex gap-2">
              <button
                onClick={() => {
                  setLeftOpen(!leftOpen);
                  setRightOpen(false);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md transition-all"
                style={{
                  background: leftOpen ? "var(--accent)" : "rgba(22,27,34,0.85)",
                  border: "1px solid var(--color-border)",
                  color: leftOpen ? "#0d1117" : "var(--text-primary)",
                }}
                title={t("dashboard:flightsTitle")}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 10h16M4 14h8"
                  />
                </svg>
                <span className="hidden sm:inline">{t("dashboard:flights") || "Flights"}</span>
                {totalFlightsCount > 0 && (
                  <span className="text-xs font-mono opacity-75">{totalFlightsCount}</span>
                )}
              </button>
              <button
                onClick={() => {
                  setRightOpen(!rightOpen);
                  setLeftOpen(false);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md transition-all"
                style={{
                  background: rightOpen ? "var(--accent)" : "rgba(22,27,34,0.85)",
                  border: "1px solid var(--color-border)",
                  color: rightOpen ? "#0d1117" : "var(--text-primary)",
                }}
                title={t("dashboard:statsTitle")}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <span className="hidden sm:inline">{t("dashboard:stats")}</span>
              </button>
              {isEnabled("cruise") && (
                <Link
                  to="/cruises"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md transition-all no-underline"
                  style={{
                    background: "rgba(22,27,34,0.85)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                  title={
                    nextUpcomingCruise
                      ? t("dashboard:cruiseNext", {
                          name:
                            nextUpcomingCruise.ship?.name ||
                            nextUpcomingCruise.shipNameOverride ||
                            nextUpcomingCruise.cruiseLine ||
                            t("dashboard:cruises"),
                          date: nextUpcomingCruise.startDate
                            ? new Date(nextUpcomingCruise.startDate).toLocaleDateString()
                            : "",
                        })
                      : t("dashboard:cruisesTitle")
                  }
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 17l4-8h10l4 8M5 17h14M10 9V5h4v4M12 17v3"
                    />
                  </svg>
                  <span className="hidden sm:inline">{t("dashboard:cruises")}</span>
                  {cruises.length > 0 && (
                    <span className="text-xs font-mono opacity-75">{cruises.length}</span>
                  )}
                </Link>
              )}
            </div>

            {/* Floating Top-Right Controls: add, export */}
            <div className="absolute top-3 right-3 z-20 flex gap-2">
              <button
                onClick={() => setShowFlightForm(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: "var(--accent)",
                  color: "#0d1117",
                  boxShadow: "0 0 16px var(--accent-glow)",
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span className="hidden sm:inline">{t("dashboard:addFlight")}</span>
              </button>

              {/* Export dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md transition-all"
                  style={{
                    background: "rgba(22,27,34,0.85)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-muted)",
                  }}
                  title={t("dashboard:export")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
                {showExportMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl z-50"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--color-border)",
                      minWidth: "140px",
                    }}
                  >
                    {(["csv", "pdf", "geojson", "kml"] as const).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => {
                          handleExport(fmt);
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                        style={{ color: "var(--text-primary)" }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background =
                            "var(--bg-muted)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        }}
                      >
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                    <div style={{ borderTop: "1px solid var(--color-border)" }} />
                    <button
                      onClick={() => {
                        handleImport();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={{ color: "var(--text-muted)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-muted)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      }}
                    >
                      {t("dashboard:import")}
                    </button>
                    <div
                      className="px-4 pb-2 text-xs"
                      style={{ color: "var(--text-muted)", opacity: 0.7 }}
                    >
                      {t("dashboard:importHint")}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Left Overlay Panel: Flight List */}
            <FlightPanel
              flights={recentFlights}
              totalCount={totalFlightsCount}
              isOpen={leftOpen}
              onClose={() => setLeftOpen(false)}
              onEdit={(flight) => setEditingFlight(flight)}
              onDuplicate={handleDuplicateFlight}
              onDelete={handleDeleteFlight}
              onAddFlight={() => setShowFlightForm(true)}
              allFlights={allFlights}
              onTripSelect={(tripId) => {
                setActiveTripId(tripId);
                setVisMode("trip-routes");
              }}
            />

            {/* Right Overlay Panel: Stats */}
            <AnimatePresence>
              {rightOpen && (
                <>
                  <div
                    className="fixed inset-0 bg-black/40 z-30"
                    onClick={() => setRightOpen(false)}
                  />
                  <motion.div
                    initial={{ x: 380 }}
                    animate={{ x: 0 }}
                    exit={{ x: 380 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="fixed right-0 top-14 bottom-0 w-80 max-w-[calc(100vw-3rem)] z-40 flex flex-col overflow-hidden"
                    style={{
                      background: "rgba(22,27,34,0.95)",
                      backdropFilter: "blur(20px)",
                      borderLeft: "1px solid var(--color-border)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t("dashboard:stats")}
                      </span>
                      <button
                        onClick={() => setRightOpen(false)}
                        style={{ color: "var(--text-muted)" }}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                      <ErrorBoundary
                        fallback={
                          <div style={{ color: "var(--text-muted)" }}>
                            {t("dashboard:statsUnavailable")}
                          </div>
                        }
                      >
                        <Stats filters={filters} />
                      </ErrorBoundary>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Modals */}
      {showFlightForm && (
        <SimplifiedFlightFormV2
          onSubmit={handleAddFlight}
          onCancel={() => setShowFlightForm(false)}
          onBatchComplete={handleBatchComplete}
        />
      )}

      {editingFlight && (
        <FlightEditModal
          flight={editingFlight}
          isOpen={!!editingFlight}
          onClose={() => setEditingFlight(null)}
          onSave={handleUpdateFlight}
        />
      )}

      {/* Duplicate Flight Dialog */}
      {duplicatingFlight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              {t("dashboard:duplicateDialog.title")}
            </h3>
            <p className="mb-4" style={{ color: "var(--text-muted)" }}>
              {t("dashboard:duplicateDialog.description", {
                route: `${duplicatingFlight.depIata ?? "?"} → ${duplicatingFlight.arrIata ?? "?"}`,
              })}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void executeDuplicate(duplicatingFlight, "outbound")}
                className="w-full px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ background: "rgba(56,139,253,0.15)", color: "#388bfd" }}
              >
                ✈️ {t("dashboard:duplicateDialog.outbound")}
              </button>
              <button
                type="button"
                onClick={() => void executeDuplicate(duplicatingFlight, "return")}
                className="w-full px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ background: "rgba(63,185,80,0.15)", color: "var(--success)" }}
              >
                🔄 {t("dashboard:duplicateDialog.return")}
              </button>
              <button
                type="button"
                onClick={() => setDuplicatingFlight(null)}
                className="w-full px-4 py-2 rounded-lg transition-colors"
                style={{ border: "1px solid var(--color-border)", color: "var(--text-muted)" }}
              >
                {t("dashboard:duplicateDialog.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <HelpIcon
        content={visMode === "globe" ? t("dashboard:map.help3d") : t("dashboard:map.help2d")}
        expandedContent={t("dashboard:map.helpExpanded")}
        position="bottom"
      />
    </div>
  );
}

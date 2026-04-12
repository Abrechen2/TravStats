/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect, useMemo } from "react";
import { flightsApi, tripsApi } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import type { Flight, FlightFilters, FlightInput, Trip } from "../types";
import Filters from "../components/Filters";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import FlightEditModal from "../components/FlightEditModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useToastStore } from "../store/toastStore";
import { useSettingsStore } from "../store/settingsStore";
import { API_LIMITS } from "../lib/constants";
import { formatDateInTimezone } from "../lib/dateUtils";
import { resolveAirlineDisplay } from "../lib/airlineUtils";
import { useTranslation } from "../hooks/useTranslation";
import DataSourceBadges from "../components/DataSourceBadges";
import { logger } from "../lib/logger";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";
import TripsTab from "../components/Trips/TripsTab";

export default function FlightsTablePage(): JSX.Element {
  const { t } = useTranslation(["flights", "common", "dashboard", "trips"]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [activeTab, setActiveTab] = useState<"flights" | "trips">("flights");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripFilter, setTripFilter] = useState<"all" | "with" | "without" | string>("all");
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loading, setLoading] = useState(true);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flightToDelete, setFlightToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"departureTime" | "airline" | "status" | "duration">(
    "departureTime"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showAddFlight, setShowAddFlight] = useState(false);
  const addToast = useToastStore((state) => state.addToast);
  const timezone = useSettingsStore((s) => s.display.timezone);

  useEffect(() => {
    loadFlights();
  }, [filters]);

  useEffect(() => {
    void loadTrips();
  }, []);

  const loadTrips = async () => {
    try {
      const data = await tripsApi.getAll();
      setTrips(data);
    } catch (err) {
      logger.warn({ err }, "Failed to load trips");
    }
  };

  const loadFlights = async () => {
    try {
      setLoading(true);
      // minRouteCount is a map-only filter — not applied to API queries
      const { minRouteCount: _mapOnly, ...apiFilters } = filters;
      void _mapOnly;
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      const MAX_PAGES = 200;
      let pages = 0;
      while (pages < MAX_PAGES) {
        pages++;
        const data = await flightsApi.getAll({ ...apiFilters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

        if (data.flights.length < limit) {
          break;
        }
        offset += limit;
      }

      setFlights(allFlights);
    } catch (error) {
      logger.error("Failed to load flights:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setFlightToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!flightToDelete) return;

    try {
      await flightsApi.delete(flightToDelete);
      addToast("success", t("flights:table.toast.deleted"));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
      loadFlights();
    } catch (error) {
      logger.error("Failed to delete flight:", error);
      addToast("error", t("dashboard:errors.deleteFlight"));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Flight>) => {
    try {
      await flightsApi.update(id, updates);
      addToast("success", t("flights:table.toast.updated"));
      setEditingFlight(null);
      loadFlights();
    } catch (error) {
      logger.error("Failed to update flight:", error);
      addToast("error", t("dashboard:errors.updateFlight"));
      throw error;
    }
  };

  const handleAddFlight = async (
    flight: FlightInput,
    force = false,
    hasMoreFlights = false
  ): Promise<void> => {
    try {
      await flightsApi.create(flight, force);
      addToast("success", t("flights:table.toast.updated"));
      if (!hasMoreFlights) {
        setShowAddFlight(false);
      }
      void loadFlights();
    } catch (error) {
      logger.error("Failed to add flight:", error);
      throw error;
    }
  };

  const getDurationMinutes = (flight: Flight) =>
    flight.departureTime && flight.arrivalTime
      ? (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60000
      : 0;

  const tripMap = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);

  const sortedFlights = useMemo(
    () =>
      [...flights].sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case "departureTime":
            comparison =
              (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
              (b.departureTime ? new Date(b.departureTime).getTime() : 0);
            break;
          case "airline":
            comparison = (a.airline || "").localeCompare(b.airline || "");
            break;
          case "status":
            comparison = a.status.localeCompare(b.status);
            break;
          case "duration":
            comparison = getDurationMinutes(a) - getDurationMinutes(b);
            break;
        }

        return sortOrder === "asc" ? comparison : -comparison;
      }),
    [flights, sortBy, sortOrder]
  );

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const displayedFlights = useMemo(
    () =>
      sortedFlights.filter((f) => {
        if (tripFilter === "all") return true;
        if (tripFilter === "with") return !!f.tripId;
        if (tripFilter === "without") return !f.tripId;
        return f.tripId === tripFilter;
      }),
    [sortedFlights, tripFilter]
  );

  const formatDate = (date: string | null): string =>
    date ? formatDateInTimezone(date, timezone) : "—";

  const formatDurationHours = (departure: string | null, arrival: string | null) => {
    if (!departure || !arrival) return "—";
    const minutes = getDurationMinutes({
      departureTime: departure,
      arrivalTime: arrival,
    } as Flight);
    const hours = minutes / 60;
    return `${hours.toFixed(1)} h`;
  };

  const sortLabels: Record<typeof sortBy, string> = {
    departureTime: t("flights:table.sort.departure"),
    airline: t("flights:table.sort.airline"),
    status: t("flights:table.sort.status"),
    duration: t("flights:table.sort.duration"),
  };

  const thStyle: React.CSSProperties = {
    color: "var(--text-muted)",
  };

  const activeSortStyle: React.CSSProperties = {
    color: "var(--accent)",
    borderBottom: "2px solid var(--accent)",
  };

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />

        {/* Sticky filter bar */}
        <div
          className="sticky top-14 z-10 px-4 py-3 backdrop-blur-md"
          style={{
            background: "rgba(13,17,23,0.85)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Filters onFilterChange={setFilters} />
        </div>

        {/* Main Content */}
        <div className="container mx-auto px-4 py-6 max-w-7xl">
          <div className="flex items-center justify-between mb-4">
            <button
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => setShowAddFlight(true)}
            >
              <span>+</span>
              <span>{t("dashboard:addFlight")}</span>
            </button>
          </div>

          {/* Tab bar */}
          <div
            className="flex border-b rounded-t-lg overflow-hidden"
            style={{ background: "var(--bg-surface)", borderColor: "var(--color-border)" }}
          >
            <button
              onClick={() => setActiveTab("flights")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "flights"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              ✈ {t("trips:tabFlights")}
            </button>
            <button
              onClick={() => setActiveTab("trips")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "trips"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              🗺 {t("trips:tab")}
              {trips.length > 0 && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-[var(--bg-muted)]">
                  {trips.length}
                </span>
              )}
            </button>
          </div>

          {/* Table */}
          <div
            className="rounded-b-lg shadow-sm overflow-hidden"
            style={{ border: "1px solid var(--color-border)", borderTop: "none" }}
          >
            {activeTab === "flights" ? (
              <>
                {/* Trip filter chips */}
                <div
                  className="flex flex-wrap gap-2 px-4 py-2"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  {(["all", "with", "without"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setTripFilter(f)}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        tripFilter === f
                          ? "bg-[var(--accent)]/20 border-[var(--accent)]/50 text-[var(--accent)]"
                          : "border-[var(--color-border)] text-[var(--text-muted)]"
                      }`}
                    >
                      {t(`trips:filter.${f}`)}
                    </button>
                  ))}
                  {trips.map((trip) => (
                    <button
                      key={trip.id}
                      onClick={() => setTripFilter(tripFilter === trip.id ? "all" : trip.id)}
                      className="px-3 py-1 rounded-full text-xs border transition-colors"
                      style={{
                        background: tripFilter === trip.id ? `${trip.color}22` : "transparent",
                        borderColor: `${trip.color}55`,
                        color: trip.color,
                      }}
                    >
                      ● {trip.name}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  {loading ? (
                    <SkeletonTable rows={10} />
                  ) : displayedFlights.length === 0 ? (
                    <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
                      <p className="text-lg mb-2">{t("flights:table.noFlights")}</p>
                      <p className="text-sm">{t("flights:table.noFlightsHint")}</p>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead
                        style={{
                          background: "var(--bg-elevated)",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        <tr>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            <button
                              onClick={() => handleSort("airline")}
                              className="flex items-center gap-1"
                              style={sortBy === "airline" ? activeSortStyle : undefined}
                            >
                              {t("flights:table.airline")}
                              {sortBy === "airline" && (sortOrder === "asc" ? "▼" : "▲")}
                            </button>
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.flightNumber")}
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.route")}
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            <button
                              onClick={() => handleSort("departureTime")}
                              className="flex items-center gap-1"
                              style={sortBy === "departureTime" ? activeSortStyle : undefined}
                            >
                              {t("flights:table.departure")}
                              {sortBy === "departureTime" && (sortOrder === "asc" ? "▼" : "▲")}
                            </button>
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.arrival")}
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            <button
                              onClick={() => handleSort("status")}
                              className="flex items-center gap-1"
                              style={sortBy === "status" ? activeSortStyle : undefined}
                            >
                              {t("flights:table.status")}
                              {sortBy === "status" && (sortOrder === "asc" ? "▼" : "▲")}
                            </button>
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            <button
                              onClick={() => handleSort("duration")}
                              className="flex items-center gap-1"
                              style={sortBy === "duration" ? activeSortStyle : undefined}
                            >
                              {t("flights:table.flightTime")}
                              {sortBy === "duration" && (sortOrder === "asc" ? "▼" : "▲")}
                            </button>
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.aircraft")}
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.price")}
                          </th>
                          <th
                            className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("trips:tab")}
                          </th>
                          <th
                            className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider"
                            style={thStyle}
                          >
                            {t("flights:table.actions")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedFlights.map((flight, index) => {
                          const tripEntry = flight.tripId ? tripMap.get(flight.tripId) : undefined;
                          return (
                            <tr
                              key={flight.id}
                              className="transition-colors"
                              style={{
                                background:
                                  index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLTableRowElement).style.background =
                                  "var(--bg-muted)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLTableRowElement).style.background =
                                  index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)";
                              }}
                            >
                              <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                                <div className="font-medium">
                                  {resolveAirlineDisplay(flight.airline, flight.flightNumber) ||
                                    t("common:labels.notAvailable")}
                                </div>
                              </td>
                              <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                                {flight.flightNumber || t("common:labels.notAvailable")}
                              </td>
                              <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="font-mono font-semibold"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    {flight.depIata || flight.depIcao}
                                  </span>
                                  <span style={{ color: "var(--text-muted)" }}>
                                    {t("common:labels.routeSeparator")}
                                  </span>
                                  <span
                                    className="font-mono font-semibold"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    {flight.arrIata || flight.arrIcao}
                                  </span>
                                </div>
                                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                                  {flight.depName?.substring(0, 20)}{" "}
                                  {t("common:labels.routeSeparator")}{" "}
                                  {flight.arrName?.substring(0, 20)}
                                </div>
                              </td>
                              <td
                                className="px-4 py-3 text-sm"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {formatDate(flight.departureTime)}
                              </td>
                              <td
                                className="px-4 py-3 text-sm"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {formatDate(flight.arrivalTime)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-2">
                                  <span
                                    className="px-2 py-1 text-xs font-semibold rounded-full"
                                    style={
                                      flight.status === "flown"
                                        ? {
                                            background: "rgba(63,185,80,0.15)",
                                            color: "var(--success)",
                                          }
                                        : flight.status === "scheduled"
                                          ? {
                                              background: "rgba(56,139,253,0.15)",
                                              color: "#388bfd",
                                            }
                                          : {
                                              background: "rgba(248,81,73,0.15)",
                                              color: "var(--danger)",
                                            }
                                    }
                                  >
                                    {t(`flights:status.${flight.status}`, {
                                      defaultValue: flight.status,
                                    })}
                                  </span>
                                  <DataSourceBadges flight={flight} />
                                </div>
                              </td>
                              <td
                                className="px-4 py-3 text-sm"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {formatDurationHours(flight.departureTime, flight.arrivalTime)}
                              </td>
                              <td
                                className="px-4 py-3 text-sm"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {flight.aircraft || t("common:labels.notAvailable")}
                              </td>
                              <td
                                className="px-4 py-3 text-sm"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {flight.price
                                  ? `${flight.price.toFixed(2)} ${flight.currency || "EUR"}`
                                  : t("common:labels.notAvailable")}
                              </td>
                              <td className="px-3 py-2">
                                {tripEntry ? (
                                  <button
                                    onClick={() => setActiveTab("trips")}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-all hover:brightness-110"
                                    style={{
                                      background: `${tripEntry.color}18`,
                                      borderColor: `${tripEntry.color}44`,
                                      color: tripEntry.color,
                                    }}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ background: tripEntry.color }}
                                    />
                                    {tripEntry.name}
                                  </button>
                                ) : (
                                  <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => setEditingFlight(flight)}
                                    className="px-3 py-1 text-xs font-medium rounded"
                                    style={{
                                      background: "rgba(56,139,253,0.15)",
                                      color: "#388bfd",
                                    }}
                                  >
                                    {t("common:buttons.edit")}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteClick(flight.id)}
                                    className="px-3 py-1 text-xs font-medium rounded"
                                    style={{
                                      background: "rgba(248,81,73,0.15)",
                                      color: "var(--danger)",
                                    }}
                                  >
                                    {t("common:buttons.delete")}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer */}
                {!loading && displayedFlights.length > 0 && (
                  <div
                    className="px-4 py-3"
                    style={{
                      background: "var(--bg-elevated)",
                      borderTop: "1px solid var(--color-border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        {t("flights:table.footer.showing", { count: displayedFlights.length })}
                      </div>
                      <div className="text-sm">
                        {t("flights:table.footer.sortedBy", {
                          label: sortLabels[sortBy],
                          direction:
                            sortOrder === "asc"
                              ? t("common:sort.ascending")
                              : t("common:sort.descending"),
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <TripsTab trips={trips} onTripsChange={() => void loadTrips()} />
            )}
          </div>
        </div>

        {/* Edit Modal */}
        {editingFlight && (
          <FlightEditModal
            flight={editingFlight}
            isOpen={!!editingFlight}
            onClose={() => setEditingFlight(null)}
            onSave={handleUpdate}
          />
        )}

        {/* Add Flight Modal */}
        {showAddFlight && (
          <SimplifiedFlightFormV2
            onSubmit={handleAddFlight}
            onCancel={() => setShowAddFlight(false)}
          />
        )}

        {/* Delete Confirmation Modal */}
        <ConfirmModal
          isOpen={deleteConfirmOpen}
          onClose={() => {
            setDeleteConfirmOpen(false);
            setFlightToDelete(null);
          }}
          onConfirm={handleDelete}
          title={t("flights:table.deleteConfirm.title")}
          message={t("flights:table.deleteConfirm.message")}
          confirmText={t("flights:table.deleteConfirm.confirm")}
          cancelText={t("flights:table.deleteConfirm.cancel")}
          confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500"
        />
      </div>
    </PageTransition>
  );
}

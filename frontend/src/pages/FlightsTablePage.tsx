/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect } from "react";
import { flightsApi } from "../lib/api";
import ContextualHint from "../components/Onboarding/ContextualHint";
import NavigationBar from "../components/NavigationBar";
import type { Flight, FlightFilters, FlightInput } from "../types";
import Filters from "../components/Filters";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import FlightEditModal from "../components/FlightEditModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useToastStore } from "../store/toastStore";
import { API_LIMITS, DATE_FORMATS, getDateLocale } from "../lib/constants";
import { useTranslation } from "../hooks/useTranslation";
import DataSourceBadges from "../components/DataSourceBadges";
import { logger } from "../lib/logger";
import PageTransition from "../components/PageTransition";

export default function FlightsTablePage(): JSX.Element {
  const { t } = useTranslation(["flights", "common", "dashboard"]);
  const [flights, setFlights] = useState<Flight[]>([]);
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

  useEffect(() => {
    loadFlights();
  }, [filters]);

  const loadFlights = async () => {
    try {
      setLoading(true);
      const { minRouteCount: _mc, ...apiFilters } = filters; // eslint-disable-line @typescript-eslint/no-unused-vars
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      // eslint-disable-next-line no-constant-condition
      while (true) {
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

  const handleAddFlight = async (flight: FlightInput): Promise<void> => {
    try {
      await flightsApi.create(flight);
      addToast("success", t("flights:table.toast.updated"));
      setShowAddFlight(false);
      void loadFlights();
    } catch (error) {
      logger.error("Failed to add flight:", error);
      addToast("error", t("dashboard:errors.addFlight"));
    }
  };

  const getDurationMinutes = (flight: Flight) =>
    (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60000;

  const sortedFlights = [...flights].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "departureTime":
        comparison = new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime();
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
  });

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(getDateLocale(), DATE_FORMATS.DEFAULT);
  };

  const formatDurationHours = (departure: string, arrival: string) => {
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
            <ContextualHint
              id="flights-table-page-hint"
              title={t("flights:table.welcome")}
              message={t("flights:table.description")}
              linkTo="/"
              linkText={t("flights:table.backToDashboard")}
            />
            <button
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => setShowAddFlight(true)}
            >
              <span>+</span>
              <span>{t("dashboard:addFlight")}</span>
            </button>
          </div>

          {/* Table */}
          <div
            className="rounded-lg shadow-sm overflow-hidden"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <div className="overflow-x-auto">
              {loading ? (
                <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
                  {t("flights:table.loading")}
                </div>
              ) : sortedFlights.length === 0 ? (
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
                        className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider"
                        style={thStyle}
                      >
                        {t("flights:table.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFlights.map((flight, index) => (
                      <tr
                        key={flight.id}
                        className="transition-colors"
                        style={{
                          background: index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
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
                            {flight.airline || t("common:labels.notAvailable")}
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
                            {flight.depName?.substring(0, 20)} {t("common:labels.routeSeparator")}{" "}
                            {flight.arrName?.substring(0, 20)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                          {formatDate(flight.departureTime)}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
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
                        <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                          {formatDurationHours(flight.departureTime, flight.arrivalTime)}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                          {flight.aircraft || t("common:labels.notAvailable")}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                          {flight.price
                            ? `${flight.price.toFixed(2)} ${flight.currency || "EUR"}`
                            : t("common:labels.notAvailable")}
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
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {!loading && sortedFlights.length > 0 && (
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
                    {t("flights:table.footer.showing", { count: sortedFlights.length })}
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

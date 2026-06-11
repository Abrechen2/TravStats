/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { flightsApi, tripsApi } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import type { Flight, FlightFilters, FlightInput, Trip } from "../types";
import Filters from "../components/Filters";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import SpecialFlightModal from "../components/SpecialFlightModal";
import FlightEditModal from "../components/FlightEditModal";
import FlightRowActions from "../components/FlightRowActions";
import SpecialTypeBadge from "../components/specialFlights/SpecialTypeBadge";
import { buildDuplicateInput } from "../lib/flightDuplicate";
import type { SpecialType } from "../components/specialFlights/specialTypeMeta";
import SpecialFlightFilter, {
  type SpecialTypeFilter,
} from "../components/specialFlights/SpecialFlightFilter";
import ConfirmModal from "../components/Training/ConfirmModal";
import { TripFilterBar } from "../components/Flights/TripFilterBar";
import { useToastStore } from "../store/toastStore";
import { useSettingsStore } from "../store/settingsStore";
import { API_LIMITS } from "../lib/constants";
import { formatDateInTimezone } from "../lib/dateUtils";
import { getFlightDuration, getFlightDurationMinutes } from "../lib/flightDuration";
import { formatDurationWithEstimate } from "../lib/formatters";
import { resolveAirlineDisplay } from "../lib/airlineUtils";
import { useTranslation } from "../hooks/useTranslation";
import DataSourceBadges from "../components/DataSourceBadges";
import { logger } from "../lib/logger";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";

// Trips moved to their own /trips top-level page (Phase-1 redesign).
// This page now focuses purely on the flight table; the trip badge in
// each flight row is a Link to /trips/:id.

export default function FlightsTablePage(): JSX.Element {
  const { t } = useTranslation(["flights", "common", "dashboard", "trips", "specialFlights"]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripFilter, setTripFilter] = useState<"all" | "with" | "without" | string>("all");
  const [specialFilter, setSpecialFilter] = useState<SpecialTypeFilter>("all");
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loading, setLoading] = useState(true);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingSpecialFlight, setEditingSpecialFlight] = useState<Flight | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flightToDelete, setFlightToDelete] = useState<string | null>(null);
  const [duplicateMenuFor, setDuplicateMenuFor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"departureTime" | "airline" | "status" | "duration">(
    "departureTime"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
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
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      const MAX_PAGES = 200;
      let pages = 0;
      while (pages < MAX_PAGES) {
        pages++;
        const data = await flightsApi.getAll({ ...filters, limit, offset });
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

  // Close duplicate menu when clicking outside
  useEffect(() => {
    if (!duplicateMenuFor) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-duplicate-menu]")) {
        setDuplicateMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [duplicateMenuFor]);

  const handleDuplicate = async (flight: Flight, mode: "return" | "same") => {
    setDuplicateMenuFor(null);
    const input = buildDuplicateInput(flight, mode);
    try {
      const created = await flightsApi.create(input, { force: true });
      addToast("success", t("flights:table.toast.duplicated"));
      await loadFlights();
      setEditingFlight(created);
    } catch (error) {
      logger.error("Failed to duplicate flight:", error);
      addToast("error", t("flights:table.toast.duplicateFailed"));
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
    opts: { force?: boolean; merge?: boolean; hasMoreFlights?: boolean } = {}
  ): Promise<void> => {
    try {
      const result = (await flightsApi.create(flight, {
        force: opts.force,
        merge: opts.merge,
      })) as Flight & { mergedFields?: string[] };
      if (opts.merge && result.mergedFields && result.mergedFields.length > 0) {
        addToast(
          "success",
          t("flights:form.duplicate.mergedToast", { count: result.mergedFields.length })
        );
      } else {
        addToast("success", t("flights:table.toast.updated"));
      }
      if (!opts.hasMoreFlights) {
        setShowAddFlight(false);
      }
      void loadFlights();
    } catch (error) {
      logger.error("Failed to add flight:", error);
      throw error;
    }
  };

  const getDurationMinutes = getFlightDurationMinutes;

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
        // Trip filter
        if (tripFilter === "with" && !f.tripId) return false;
        if (tripFilter === "without" && f.tripId) return false;
        if (
          tripFilter !== "all" &&
          tripFilter !== "with" &&
          tripFilter !== "without" &&
          f.tripId !== tripFilter
        )
          return false;

        // Special-type filter
        if (specialFilter === "standard" && f.specialType) return false;
        if (specialFilter === "special" && !f.specialType) return false;
        if (
          specialFilter !== "all" &&
          specialFilter !== "standard" &&
          specialFilter !== "special" &&
          f.specialType !== specialFilter
        )
          return false;

        return true;
      }),
    [sortedFlights, tripFilter, specialFilter]
  );

  const formatDate = (date: string | null): string =>
    date ? formatDateInTimezone(date, timezone) : "—";

  const formatFlightDurationCell = (flight: Flight) => {
    const d = getFlightDuration(flight);
    return formatDurationWithEstimate(d?.minutes ?? null, d?.estimated ?? false);
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
          <Filters onFilterChange={setFilters} showMapOnlyFilters={false} />
        </div>

        {/* Main Content */}
        <div className="container mx-auto px-4 py-6 max-w-screen-2xl">
          <div className="flex items-center justify-between mb-4">
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
            <>
                {/* Trip filter — quick chips + searchable popover */}
                <TripFilterBar trips={trips} value={tripFilter} onChange={setTripFilter} />

                {/* Special-type filter chips */}
                <SpecialFlightFilter value={specialFilter} onChange={setSpecialFilter} />

                <div className="overflow-x-auto">
                  {loading ? (
                    <SkeletonTable rows={10} />
                  ) : displayedFlights.length === 0 ? (
                    <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
                      <p className="text-lg mb-2">{t("flights:table.noFlights")}</p>
                      <p className="text-sm">{t("flights:table.noFlightsHint")}</p>
                    </div>
                  ) : (
                    <table className="w-full min-w-[960px]">
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
                            className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
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
                                {flight.specialType && (
                                  <div className="mt-1">
                                    <SpecialTypeBadge type={flight.specialType as SpecialType} />
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                                {flight.flightNumber || t("common:labels.notAvailable")}
                              </td>
                              <td
                                className="px-4 py-3 max-w-[16rem]"
                                style={{ color: "var(--text-primary)" }}
                              >
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
                                <div
                                  className="text-xs truncate"
                                  style={{ color: "var(--text-muted)" }}
                                  title={
                                    flight.depName && flight.arrName
                                      ? `${flight.depName} ${t("common:labels.routeSeparator")} ${flight.arrName}`
                                      : (flight.depName ?? flight.arrName ?? undefined)
                                  }
                                >
                                  {flight.depName} {t("common:labels.routeSeparator")}{" "}
                                  {flight.arrName}
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
                                {formatFlightDurationCell(flight)}
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
                                  <Link
                                    to={`/trips/${tripEntry.id}`}
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
                                  </Link>
                                ) : (
                                  <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <FlightRowActions
                                  flight={flight}
                                  openDuplicateMenuFor={duplicateMenuFor}
                                  onToggleDuplicateMenu={setDuplicateMenuFor}
                                  onEdit={(f) => {
                                    // Special flights → SpecialFlightModal so the user
                                    // edits eclipse coords / parabolas / etc. through the
                                    // same UI that created them, not the generic edit
                                    // modal (which hides those fields entirely).
                                    if (f.specialType) {
                                      setEditingSpecialFlight(f);
                                    } else {
                                      setEditingFlight(f);
                                    }
                                  }}
                                  onDuplicate={(f, mode) => void handleDuplicate(f, mode)}
                                  onDelete={handleDeleteClick}
                                />
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
            onPickSpecialFlight={() => {
              setShowAddFlight(false);
              setShowSpecialModal(true);
            }}
          />
        )}

        {/* Special Flight Modal — create (showSpecialModal) OR edit (editingSpecialFlight) */}
        <SpecialFlightModal
          isOpen={showSpecialModal || !!editingSpecialFlight}
          flight={editingSpecialFlight}
          onClose={() => {
            setShowSpecialModal(false);
            setEditingSpecialFlight(null);
          }}
          onSaved={() => {
            setShowSpecialModal(false);
            setEditingSpecialFlight(null);
            addToast("success", t("flights:table.toast.updated"));
            void loadFlights();
          }}
        />

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

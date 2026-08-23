/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { flightsApi, tripsApi } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ListEmptyState from "../components/table/ListEmptyState";
import ListFilterBar, {
  FilterField,
  PANEL_SELECT_CLASS,
} from "../components/table/ListFilterBar";
import { statusPillStyle } from "../components/table/statusPillStyle";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import type { Flight, FlightInput, Trip } from "../types";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import SpecialFlightModal from "../components/SpecialFlightModal";
import FlightEditModal from "../components/FlightEditModal";
import FlightRowActions from "../components/FlightRowActions";
import SpecialTypeBadge from "../components/specialFlights/SpecialTypeBadge";
import { buildDuplicateInput } from "../lib/flightDuplicate";
import {
  SPECIAL_TYPES,
  type SpecialType,
  type SpecialTypeFilter,
} from "../components/specialFlights/specialTypeMeta";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useToastStore } from "../store/toastStore";
import { API_LIMITS } from "../lib/constants";
import { getFlightDuration, getFlightDurationMinutes } from "../lib/flightDuration";
import { formatDurationWithEstimate } from "../lib/formatters";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";
import AirlineWordmarkCell from "../components/flightsTable/AirlineWordmarkCell";
import RouteCell from "../components/flightsTable/RouteCell";
import TimeCell from "../components/flightsTable/TimeCell";
import SourceInfoDot from "../components/flightsTable/SourceInfoDot";

// Trips moved to their own /trips top-level page (Phase-1 redesign).
// This page now focuses purely on the flight table; the trip badge in
// each flight row is a Link to /trips/:id.

// Column-visibility ids (ColumnPicker) — header and row cells must agree.
const FLIGHT_COLUMN_IDS = [
  "airline",
  "flightNumber",
  "route",
  "time",
  "status",
  "duration",
  "aircraft",
  "price",
  "trip",
  "actions",
] as const;
const FLIGHT_ALWAYS_VISIBLE = ["route", "actions"] as const;

type FlightColumnId = (typeof FLIGHT_COLUMN_IDS)[number];
type FlightSortKey = "departureTime" | "airline" | "status" | "duration";

/**
 * Column id -> sort key. Columns without an entry are not sortable — which is
 * six of ten, the widest gap of the three list pages (cruises sort six of
 * eight, lodging all eight).
 */
const FLIGHT_SORT_KEY_BY_COLUMN: Partial<Record<FlightColumnId, FlightSortKey>> = {
  airline: "airline",
  time: "departureTime",
  status: "status",
  duration: "duration",
};

/**
 * One label source for header, column picker and footer. The page used to
 * hold three separate copies of these names, which is how a column could end
 * up called one thing in the picker and another in the footer.
 */
function flightColumnLabel(t: (key: string) => string, id: FlightColumnId): string {
  if (id === "trip") return t("trips:tab");
  if (id === "duration") return t("flights:table.flightTime");
  return t(`flights:table.${id}`);
}

type FlightStatusFilter = Flight["status"] | "all";

/** The statuses a flight can carry. `historical` and `duplicated` are real
 *  states, not hidden ones — the old checkbox panel force-added them to every
 *  selection, so picking "nur geflogen" quietly kept them in the table. */
const FLIGHT_STATUSES: ReadonlyArray<Flight["status"]> = [
  "flown",
  "scheduled",
  "cancelled",
  "historical",
  "duplicated",
];

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

export default function FlightsTablePage(): JSX.Element {
  const { t } = useTranslation([
    "flights",
    "common",
    "dashboard",
    "trips",
    "specialFlights",
    "settings",
  ]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripFilter, setTripFilter] = useState<"all" | "with" | "without" | string>("all");
  const [specialFilter, setSpecialFilter] = useState<SpecialTypeFilter>("all");
  // Every filter on this page is now decided HERE, over the complete list.
  // It used to be split: year/month/airline/status went to the server as a
  // query (re-fetching every flight on every change, while a second component
  // paginated through all of them AGAIN just to build its dropdown options),
  // and trip/special were applied in memory. One source, one pass.
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<FlightStatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [airlineFilter, setAirlineFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingSpecialFlight, setEditingSpecialFlight] = useState<Flight | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flightToDelete, setFlightToDelete] = useState<string | null>(null);
  const [duplicateMenuFor, setDuplicateMenuFor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"departureTime" | "airline" | "status" | "duration">(
    "departureTime"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const flightColumnPrefs = useColumnPrefs("flights-list", FLIGHT_ALWAYS_VISIBLE);
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const addToast = useToastStore((state) => state.addToast);

  // `?import=email` — kept for old bookmarks. It simply opens the add dialog:
  // the drop zone is its first route now, so there is no separate email view
  // left to jump to. The param is stripped so a reload does not reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("import") !== "email") return;
    setShowAddFlight(true);
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeAddFlight = (): void => {
    setShowAddFlight(false);
  };

  useEffect(() => {
    loadFlights();
  }, []);

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
      setLoadError(false);
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      const MAX_PAGES = 200;
      let pages = 0;
      while (pages < MAX_PAGES) {
        pages++;
        const data = await flightsApi.getAll({ limit, offset });
        allFlights = [...allFlights, ...data.flights];

        if (data.flights.length < limit) {
          break;
        }
        offset += limit;
      }

      setFlights(allFlights);
    } catch (error) {
      // Logged only, until now: a network failure left an empty table that
      // looked exactly like an account with no flights.
      logger.error("Failed to load flights:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Opening a flight from the row. Mirrors what the edit icon does — a special
   * flight goes to its own modal, because the generic one hides the fields
   * that make it special.
   */
  const openFlight = (f: Flight): void => {
    if (f.specialType) {
      setEditingSpecialFlight(f);
    } else {
      setEditingFlight(f);
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

  const handleUpdate = async (id: string, updates: Partial<FlightInput>) => {
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
  ): Promise<Flight> => {
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
      // The created flight flows back so the form can run its post-create
      // trip assignment (#199).
      return result;
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

  const searchNeedle = useMemo(() => search.trim().toLowerCase(), [search]);

  /** Years and airlines read from the COMPLETE list, so the options never
   *  shrink as the other filters narrow the table. */
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const f of flights) {
      if (!f.departureTime) continue;
      const y = new Date(f.departureTime).getFullYear();
      if (!Number.isNaN(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [flights]);

  const availableAirlines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flights) {
      if (!f.airline) continue;
      counts.set(f.airline, (counts.get(f.airline) ?? 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
      (a, b) => b.count - a.count
    );
  }, [flights]);

  const displayedFlights = useMemo(
    () =>
      sortedFlights.filter((f) => {
        if (statusFilter !== "all" && f.status !== statusFilter) return false;

        if (yearFilter !== "all" || monthFilter !== "all") {
          if (!f.departureTime) return false;
          const dep = new Date(f.departureTime);
          if (yearFilter !== "all" && dep.getFullYear() !== Number(yearFilter)) return false;
          if (monthFilter !== "all" && dep.getMonth() + 1 !== Number(monthFilter)) return false;
        }

        if (airlineFilter !== "all" && f.airline !== airlineFilter) return false;

        if (searchNeedle.length > 0) {
          const haystack = [
            f.airline,
            f.flightNumber,
            f.depIata,
            f.arrIata,
            f.depName,
            f.arrName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(searchNeedle)) return false;
        }

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
    [
      sortedFlights,
      tripFilter,
      specialFilter,
      statusFilter,
      yearFilter,
      monthFilter,
      airlineFilter,
      searchNeedle,
    ]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
    setMonthFilter("all");
    setAirlineFilter("all");
    setTripFilter("all");
    setSpecialFilter("all");
  };

  // Month, airline, trip and special type are the four this domain owns.
  const extraActiveCount =
    (monthFilter === "all" ? 0 : 1) +
    (airlineFilter === "all" ? 0 : 1) +
    (tripFilter === "all" ? 0 : 1) +
    (specialFilter === "all" ? 0 : 1);
  const hasActiveFilter =
    search.length > 0 || statusFilter !== "all" || yearFilter !== "all" || extraActiveCount > 0;

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


  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />

        <ListFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("flights:filter.searchPlaceholder"),
          }}
          status={{
            label: t("flights:table.status"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as FlightStatusFilter),
            allLabel: t("flights:filter.allStatuses"),
            options: FLIGHT_STATUSES.map((st) => ({
              value: st,
              label: t(`flights:status.${st}`),
            })),
          }}
          year={{
            label: t("flights:filter.year"),
            value: yearFilter,
            onChange: setYearFilter,
            allLabel: t("flights:filter.allYears"),
            options: availableYears.map((y) => ({ value: String(y), label: String(y) })),
          }}
          extraActiveCount={extraActiveCount}
          extra={
            <>
              <FilterField label={t("flights:filter.month")}>
                <select
                  value={monthFilter}
                  onChange={(e): void => setMonthFilter(e.target.value)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("flights:filter.allMonths")}</option>
                  {MONTH_KEYS.map((key, i) => (
                    <option key={key} value={String(i + 1)}>
                      {t(`stats:months.${key}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={t("flights:table.airline")}>
                <select
                  value={airlineFilter}
                  onChange={(e): void => setAirlineFilter(e.target.value)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("flights:filter.allAirlines")}</option>
                  {availableAirlines.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name} ({a.count})
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={t("trips:tab")}>
                <select
                  value={tripFilter}
                  onChange={(e): void => setTripFilter(e.target.value)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("flights:filter.allTrips")}</option>
                  <option value="with">{t("flights:filter.withTrip")}</option>
                  <option value="without">{t("flights:filter.withoutTrip")}</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </select>
              </FilterField>
              {/* Special flights used to be a row of pills above the table —
                  the only place in the app where a filter was a pill. */}
              <FilterField label={t("specialFlights:filter.label")}>
                <select
                  value={specialFilter}
                  onChange={(e): void => setSpecialFilter(e.target.value as SpecialTypeFilter)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("specialFlights:filter.all")}</option>
                  <option value="standard">{t("specialFlights:filter.standardOnly")}</option>
                  <option value="special">{t("specialFlights:filter.allSpecial")}</option>
                  {SPECIAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`specialFlights:specialType.${type}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
            </>
          }
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={t("common:filters.showing", { count: displayedFlights.length })}
        />

        {/* Main Content */}
        <div className="container mx-auto px-4 py-6 max-w-(--breakpoint-2xl)">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl font-semibold text-(--text-primary)">
              {t("dashboard:flightsTitle")}
            </h1>
            <div className="flex items-center gap-2">
              <ColumnPicker
                columns={FLIGHT_COLUMN_IDS.map((id) => ({
                  id,
                  // Two ids whose label keys don't match their column id: the
                  // duration header says "Flugzeit", the trip column borrows
                  // the trips tab title.
                  label:
                    id === "trip"
                      ? t("trips:tab")
                      : id === "duration"
                        ? t("flights:table.flightTime")
                        : t(`flights:table.${id}`),
                  always: (FLIGHT_ALWAYS_VISIBLE as readonly string[]).includes(id),
                }))}
                prefs={flightColumnPrefs}
              />
              <button
                className="btn-primary flex items-center gap-2 whitespace-nowrap"
                onClick={() => setShowAddFlight(true)}
              >
                <span>+</span>
                <span>{t("dashboard:addFlight")}</span>
              </button>
            </div>
          </div>

          <p className="mb-4 text-xs text-(--text-muted)">
            {t("flights:list.wholeListHint")}{" "}
            <Link
              to="/settings?section=import"
              className="underline underline-offset-4 hover:text-(--text-primary)"
            >
              {t("settings:import.openHub")}
            </Link>
          </p>

          {/* Table */}
          {loadError ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
            >
              {t("flights:table.loadError")}
            </div>
          ) : (
          <div
            className="rounded-lg shadow-xs overflow-hidden"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <>
              <div className="overflow-x-auto">
                {loading ? (
                  <SkeletonTable rows={10} />
                ) : displayedFlights.length === 0 ? (
                  <ListEmptyState
                    filtered={hasActiveFilter}
                    emptyTitle={t("flights:table.noFlights")}
                    emptyHint={t("flights:table.noFlightsHint")}
                    onReset={resetFilters}
                  />
                ) : (
                  <table className="w-full min-w-[960px]">
                    <thead
                      style={{
                        background: "var(--bg-elevated)",
                        borderBottom: "1px solid var(--color-border)",
                      }}
                    >
                      <tr>
                        {/*
                          One loop instead of ten copied blocks. Each sortable
                          one built its own button and showed ▼ for ascending —
                          the opposite of the shared component, and of this
                          page's own footer, which wrote "aufsteigend" beside
                          that ▼.
                        */}
                        {FLIGHT_COLUMN_IDS.filter((id) => flightColumnPrefs.isVisible(id)).map(
                          (id) => {
                            const right = id === "actions";
                            const label = flightColumnLabel(t, id);
                            const sortKey = FLIGHT_SORT_KEY_BY_COLUMN[id];
                            return (
                              <th
                                key={id}
                                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${
                                  right ? "text-right whitespace-nowrap" : "text-left"
                                }`}
                                style={thStyle}
                              >
                                {sortKey === undefined ? (
                                  label
                                ) : (
                                  <SortableHeader
                                    column={sortKey}
                                    sortBy={sortBy}
                                    sortOrder={sortOrder}
                                    onSort={handleSort}
                                    ariaLabel={t("flights:table.sortBy", { col: label })}
                                  >
                                    {label}
                                  </SortableHeader>
                                )}
                              </th>
                            );
                          }
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedFlights.map((flight, index) => {
                        const tripEntry = flight.tripId ? tripMap.get(flight.tripId) : undefined;
                        return (
                          <tr
                            key={flight.id}
                            // The row opens the flight, like the cruise and
                            // lodging rows already did. Every control inside
                            // the actions cell stops propagation, so deleting
                            // does not also navigate.
                            onClick={() => openFlight(flight)}
                            className="cursor-pointer transition-colors"
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
                            {/* py-1 instead of py-3: the brand tile fills the row height
                                set by the two-line route/time cells instead of growing it. */}
                            {flightColumnPrefs.isVisible("airline") && (
                            <td className="px-4 py-1" style={{ color: "var(--text-primary)" }}>
                              <AirlineWordmarkCell flight={flight} />
                              {flight.specialType && (
                                <div className="mt-1">
                                  <SpecialTypeBadge type={flight.specialType as SpecialType} />
                                </div>
                              )}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("flightNumber") && (
                            <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                              {flight.flightNumber || t("common:labels.notAvailable")}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("route") && (
                            <td
                              className="px-4 py-3 max-w-[16rem]"
                              style={{ color: "var(--text-primary)" }}
                            >
                              <RouteCell flight={flight} />
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("time") && (
                            <td className="px-4 py-3">
                              <TimeCell flight={flight} />
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("status") && (
                            <td className="px-4 py-3">
                              <span
                                className="px-2 py-1 text-xs font-semibold rounded-full"
                                // Shared palette. The ternary this replaces had
                                // an else branch that caught everything except
                                // flown and scheduled, so a `historical` flight
                                // was painted in the cancelled red.
                                style={statusPillStyle(flight.status)}
                              >
                                {t(`flights:status.${flight.status}`, {
                                  defaultValue: flight.status,
                                })}
                              </span>
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("duration") && (
                            <td
                              className="px-4 py-3 text-sm"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {formatFlightDurationCell(flight)}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("aircraft") && (
                            <td
                              className="px-4 py-3 text-sm"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {flight.aircraft || t("common:labels.notAvailable")}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("price") && (
                            <td
                              className="px-4 py-3 text-sm"
                              style={{
                                color: "var(--text-muted)",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {flight.price ? (
                                <>
                                  {flight.price.toFixed(2)}
                                  <span className="ml-1 text-[11px]">
                                    {flight.currency || "EUR"}
                                  </span>
                                </>
                              ) : (
                                t("common:labels.notAvailable")
                              )}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("trip") && (
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
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: tripEntry.color }}
                                  />
                                  {tripEntry.name}
                                </Link>
                              ) : (
                                <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>—</span>
                              )}
                            </td>
                            )}
                            {flightColumnPrefs.isVisible("actions") && (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
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
                                <span className="inline-flex w-[18px] justify-center">
                                  <SourceInfoDot flight={flight} />
                                </span>
                              </div>
                            </td>
                            )}
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
                  <div className="flex items-center justify-end">
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
          )}
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
            onCancel={closeAddFlight}
            onPickSpecialFlight={() => {
              closeAddFlight();
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

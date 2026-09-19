/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import AppShell from "../components/ui/AppShell";
import { flightSummaryFigures } from "../lib/flights/flightSummaryFigures";
import { airlineResolvers } from "../lib/airlineUtils";
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { flightsApi, tripsApi } from "../lib/api";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import type { Flight, FlightInput, Trip } from "../types";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import SpecialFlightModal from "../components/SpecialFlightModal";
import FlightEditModal from "../components/FlightEditModal";
import FlightRowActions from "../components/FlightRowActions";
import { buildDuplicateInput } from "../lib/flightDuplicate";
import type { SpecialTypeFilter } from "../components/specialFlights/specialTypeMeta";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useToastStore } from "../store/toastStore";
import { API_LIMITS } from "../lib/constants";
import { getFlightDuration, getFlightDurationMinutes } from "../lib/flightDuration";
import { formatDurationWithEstimate } from "../lib/formatters";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import { priceCellState } from "../lib/flightPriceCell";
import { FlightRow, FLIGHT_COLUMN_LAYOUT } from "../components/flightsTable/FlightRow";
import { FlightsFilterBar } from "../components/flightsTable/FlightsFilterBar";
import { Table, type TableColumn } from "../components/ui/Table";
import { formatAmount } from "../lib/units";
import { SkeletonTable } from "../components/SkeletonLoader";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { usePagination } from "../components/table/usePagination";
import TablePagination from "../components/table/TablePagination";
import {
  FLIGHT_ALWAYS_VISIBLE,
  FLIGHT_COLUMN_IDS,
  FLIGHT_SORT_KEY_BY_COLUMN,
  flightColumnLabel,
  type FlightStatusFilter,
} from "../components/flightsTable/flightColumns";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";

// Trips moved to their own /trips page; the trip badge is a Link to /trips/:id.

export default function FlightsTablePage(): JSX.Element {
  const { t, i18n } = useTranslation([
    "flights",
    "common",
    "dashboard",
    "trips",
    "specialFlights",
    "settings",
  ]);
  const tableHints = useTableHints();
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
  const [flightToDelete, setFlightToDelete] = useState<Flight | null>(null);
  const [duplicateMenuFor, setDuplicateMenuFor] = useState<string | null>(null);
  // Newest first everywhere, and the choice survives a reload — the
  // column choice already did (useColumnPrefs), the sort never had.
  const { sortBy, sortOrder, setSort } = useSortPrefs("flights-list", "departureTime", "desc", [
    "departureTime",
    "airline",
    "status",
    "duration",
  ] as const);
  const flightColumnPrefs = useColumnPrefs("flights-list", FLIGHT_ALWAYS_VISIBLE);
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const addToast = useToastStore((state) => state.addToast);

  // `?import=email` — kept for old bookmarks. It simply opens the add dialog:
  // the drop zone is its first route now, so there is no separate email view
  // left to jump to. The param is stripped so a reload does not reopen it.
  const navigate = useNavigate();
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
   * The row opens the flight's PAGE now, like a cruise row and a lodging row
   * always did. It used to open the edit form, which was the only way to read
   * the ~50 fields the table has no column for — reading meant entering an
   * editable state. The edit icon still goes straight to the form.
   */
  const openFlight = (f: Flight): void => {
    navigate(`/flights/${f.id}`);
  };

  /** "LH2462 MUC → CPH" — enough to recognise the row you clicked. */
  const flightLabel = (f: Flight): string => {
    const route = [f.depIata, f.arrIata].filter(Boolean).join(" → ");
    return [f.flightNumber, route].filter(Boolean).join(" ") || t("common:labels.unknown");
  };

  const handleDeleteClick = (id: string) => {
    setFlightToDelete(flights.find((f) => f.id === id) ?? null);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!flightToDelete) return;

    try {
      await flightsApi.delete(flightToDelete.id);
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
        // handleAddFlight always CREATES. Reporting "updated" told the user
        // they had edited an existing record (Forgejo #11). The merge branch
        // above keeps its own wording because a merge really did change a row.
        addToast("success", t("flights:table.toast.created"));
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
    setSort(column, sortBy === column ? (sortOrder === "asc" ? "desc" : "asc") : "desc");
  };

  /**
   * The visible columns, in order, with their narrow places and their sort
   * headers. One list feeds the head and every row, so a cell can no longer
   * land under the wrong column — which is what the two separate
   * `isVisible` filters, one in the head and one in the body, made possible.
   */
  const visibleColumns = useMemo<TableColumn[]>(
    () =>
      FLIGHT_COLUMN_IDS.filter((id) => flightColumnPrefs.isVisible(id)).map((id) => {
        const layout = FLIGHT_COLUMN_LAYOUT[id];
        const label = flightColumnLabel(t, id);
        const sortKey = FLIGHT_SORT_KEY_BY_COLUMN[id];
        return {
          key: id,
          min: layout.min,
          grow: layout.grow,
          priority: layout.priority,
          align: layout.align,
          mono: layout.mono,
          onNarrow: layout.onNarrow,
          label:
            sortKey === undefined ? (
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
            ),
        };
      }),
    [flightColumnPrefs, t, sortBy, sortOrder]
  );

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
          const haystack = [f.airline, f.flightNumber, f.depIata, f.arrIata, f.depName, f.arrName]
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
  // Paginates the filtered+sorted set; the summary strip stays on the full list.
  const pagination = usePagination(displayedFlights, "flights-list");

  /** The rule, the note and the reasons live in `lib/flights/flightSummaryFigures`. */
  const summaryFigures = useMemo(
    () =>
      flightSummaryFigures(displayedFlights, airlineResolvers, {
        flights: t("common:summary.flights"),
        airlines: t("common:summary.airlines"),
        airports: t("common:summary.airports"),
        withoutAirline: (count) => t("common:summary.withoutAirline", { count }),
      }),
    [displayedFlights, t]
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

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="t-screen-title">{t("dashboard:flightsTitle")}</h1>
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

        <ListSummaryStrip
          figures={summaryFigures}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadError}
        />

        <p className="mb-4 text-xs text-(--text-muted)">
          {t("flights:list.wholeListHint")}{" "}
          <Link
            to="/settings/data?section=import"
            className="underline underline-offset-4 hover:text-(--text-primary)"
          >
            {t("settings:import.openHub")}
          </Link>
        </p>

        <FlightsFilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          yearFilter={yearFilter}
          onYearChange={setYearFilter}
          availableYears={availableYears}
          monthFilter={monthFilter}
          onMonthChange={setMonthFilter}
          airlineFilter={airlineFilter}
          onAirlineChange={setAirlineFilter}
          availableAirlines={availableAirlines}
          tripFilter={tripFilter}
          onTripChange={setTripFilter}
          trips={trips}
          specialFilter={specialFilter}
          onSpecialChange={setSpecialFilter}
          extraActiveCount={extraActiveCount}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          loading={loading}
          loadError={loadError}
          resultCount={displayedFlights.length}
        />

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("flights:table.loadError")}
          </div>
        ) : (
          <>
            {loading ? (
              <SkeletonTable rows={10} />
            ) : displayedFlights.length === 0 ? (
              <div
                className="overflow-hidden rounded-lg"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <ListEmptyState
                  filtered={hasActiveFilter}
                  emptyTitle={t("flights:table.noFlights")}
                  emptyHint={t("flights:table.noFlightsHint")}
                  onReset={resetFilters}
                />
              </div>
            ) : (
              <Table columns={visibleColumns} label={t("flights:table.title")} {...tableHints}>
                {pagination.paged.map((flight) => (
                  <FlightRow
                    key={flight.id}
                    flight={flight}
                    trip={flight.tripId ? tripMap.get(flight.tripId) : undefined}
                    columns={visibleColumns}
                    language={i18n.language}
                    durationText={formatFlightDurationCell(flight)}
                    onOpen={() => openFlight(flight)}
                    cells={{
                      flightNumber: flight.flightNumber || t("common:labels.notAvailable"),
                      duration: formatFlightDurationCell(flight),
                      aircraft: flight.aircraft || t("common:labels.notAvailable"),
                      price:
                        priceCellState(flight) === "amount" ? (
                          formatAmount(flight.price!, flight.currency, {
                            language: i18n.language,
                          })
                        ) : priceCellState(flight) === "package" ? (
                          <span title={t("flights:price.packageHint")}>
                            {t("flights:price.package")}
                          </span>
                        ) : (
                          t("common:labels.notAvailable")
                        ),
                    }}
                    actions={
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
                    }
                  />
                ))}
              </Table>
            )}
            {!loading && displayedFlights.length > 0 && <TablePagination {...pagination} />}
            {/* Footer */}
            {!loading && displayedFlights.length > 0 && (
              <p className="mt-2 px-1 text-right text-xs text-(--text-muted)">
                {t("flights:table.footer.sortedBy", {
                  label: sortLabels[sortBy],
                  direction:
                    sortOrder === "asc" ? t("common:sort.ascending") : t("common:sort.descending"),
                })}
              </p>
            )}
          </>
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
          // This one modal serves both create and edit, so the message has
          // to be read off which one is open — BEFORE the state is cleared,
          // or it always reports a create (Forgejo #11).
          const wasEdit = !!editingSpecialFlight;
          setShowSpecialModal(false);
          setEditingSpecialFlight(null);
          addToast(
            "success",
            t(wasEdit ? "flights:table.toast.updated" : "flights:table.toast.created")
          );
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
        // Names the flight, like the other five dialogs do now. "Diesen
        // Flug" was fine on a detail page and wrong in a list, where the
        // row you clicked may not be the row you meant.
        message={t("flights:table.deleteConfirm.message", {
          name: flightToDelete ? flightLabel(flightToDelete) : "",
        })}
        confirmText={t("flights:table.deleteConfirm.confirm")}
        cancelText={t("flights:table.deleteConfirm.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}

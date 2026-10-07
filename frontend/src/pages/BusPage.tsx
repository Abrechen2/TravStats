import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { Table } from "../components/ui/Table";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import ListFilterBar, { SEARCH_MAX_LENGTH } from "../components/table/ListFilterBar";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { ColumnPicker } from "../components/table/ColumnPicker";
import TablePagination from "../components/table/TablePagination";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { logbookColumns } from "../components/table/logbookColumns";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import { useServerPagination } from "../components/table/useServerPagination";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { SkeletonTable } from "../components/SkeletonLoader";
import ConfirmModal from "../components/Training/ConfirmModal";
import { BusFormModal } from "../components/bus/BusFormModal";
import { BusTableRow, BUS_COLUMN_LAYOUT, type BusColumnId } from "../components/bus/BusTableRow";
import { railSummaryFigures } from "../lib/rail/railSummaryFigures";
import { busApi, type BusListQuery, type BusListSummary } from "../lib/api/bus";
import { busYear } from "../shared/busCounting";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { BusJourney, BusStatus } from "../types/bus";

const EMPTY_BUS_SUMMARY: BusListSummary = {
  journeys: 0,
  operators: 0,
  withoutOperator: 0,
  stations: 0,
};

const BUS_STATUSES: readonly BusStatus[] = ["scheduled", "in_progress", "completed", "cancelled"];
const BUS_COLUMN_IDS: readonly BusColumnId[] = [
  "operator",
  "route",
  "time",
  "line",
  "duration",
  "distance",
  "status",
  "trip",
  "actions",
];
/** The mark, title, subtitle and pill a phone keeps, plus the actions. */
const BUS_ALWAYS_VISIBLE = ["operator", "route", "time", "status", "actions"] as const;
const BUS_SORT_FIELDS = ["departure", "distance", "created"] as const;
type BusSortField = (typeof BUS_SORT_FIELDS)[number];
/** The endpoint's page cap — one request covers the years of any realistic logbook. */
const YEAR_SCAN_LIMIT = 500;

type Filters = Pick<BusListQuery, "q" | "status" | "year">;
type Editing = { journey: BusJourney | null } | null;

/**
 * The bus logbook (spec 2026-10-07-bus-domain-design §11), in the layout every
 * logbook shares: title and the add button, the summary strip, the filter bar,
 * a server-paged table. The route is gated twice (beta switch + domain
 * choice) in App.tsx. New rides are typed in — bus has no ticket import.
 */
export default function BusPage(): JSX.Element {
  const { t } = useTranslation(["bus", "common"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [rides, setRides] = useState<BusJourney[]>([]);
  const [total, setTotal] = useState(0);
  // Null until the server has counted: the strip then says nothing, not "0".
  const [summary, setSummary] = useState<BusListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<BusStatus | "all">("all");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<BusJourney | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback((): void => setReloadToken((n) => n + 1), []);
  const columnPrefs = useColumnPrefs("bus-list", BUS_ALWAYS_VISIBLE);
  const { sortBy, sortOrder, setSort } = useSortPrefs<BusSortField>(
    "bus-list",
    "departure",
    "desc",
    BUS_SORT_FIELDS
  );

  const filters = useMemo<Filters>(() => {
    const needle = debouncedSearch.trim().slice(0, SEARCH_MAX_LENGTH);
    return {
      ...(needle && { q: needle }),
      ...(statusFilter !== "all" && { status: statusFilter }),
      ...(yearFilter !== "all" && { year: yearFilter }),
    };
  }, [debouncedSearch, statusFilter, yearFilter]);
  const signature = `${filters.q ?? ""}|${filters.status ?? ""}|${filters.year ?? ""}`;
  const pagination = useServerPagination(total, "bus-list", signature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const page = await busApi.list({
          ...filters,
          sort: sortBy,
          order: sortOrder,
          limit,
          offset,
        });
        if (cancelled) return;
        setRides(page.journeys);
        setTotal(page.total);
        setSummary(page.summary);
        setLoadFailed(false);
      } catch (err: unknown) {
        if (cancelled) return;
        // A failed load is said, never drawn as an empty logbook.
        logger.error("BusPage: failed to load rides", err);
        setLoadFailed(true);
        setLoadFailure(loadFailureLog(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filters, sortBy, sortOrder, limit, offset, reloadToken]);

  // The year options: every year the account rode in, not just the filtered
  // page's — picking a year must not take the other years off the list.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const all = await busApi.list({ limit: YEAR_SCAN_LIMIT, sort: "departure", order: "desc" });
        if (!cancelled) {
          setYears([...new Set(all.journeys.map(busYear))].sort((a, b) => b - a));
        }
      } catch (err: unknown) {
        // The list works without them; the year select then offers "all" only.
        logger.error("BusPage: failed to load the year options", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleSaved = (): void => {
    setEditing(null);
    addToast("success", t("bus:saved"));
    reload();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await busApi.remove(toDelete.id);
      addToast("success", t("bus:deleted"));
      setToDelete(null);
      reload();
    } catch (err: unknown) {
      logger.error("BusPage: delete failed", err);
      addToast("error", t("bus:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(
    () =>
      logbookColumns<BusColumnId, BusSortField>({
        ids: BUS_COLUMN_IDS,
        layout: BUS_COLUMN_LAYOUT,
        isVisible: columnPrefs.isVisible,
        label: (id) => t(`bus:list.${id}`),
        sortKeyByColumn: { time: "departure", distance: "distance" },
        sortBy,
        sortOrder,
        onSort: (field) =>
          setSort(field, field === sortBy && sortOrder === "desc" ? "asc" : "desc"),
        sortAriaLabel: (col) => t("bus:list.sortBy", { col }),
      }),
    [columnPrefs, t, sortBy, sortOrder, setSort]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
  };
  const hasActiveFilter = search.length > 0 || statusFilter !== "all" || yearFilter !== "all";
  const add = t("bus:add");

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("bus:title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={BUS_COLUMN_IDS.map((id) => ({
                id,
                label: t(`bus:list.${id}`),
                always: (BUS_ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            <button
              type="button"
              onClick={(): void => setEditing({ journey: null })}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{add}</span>
            </button>
          </div>
        </div>

        <ListSummaryStrip
          figures={railSummaryFigures(summary ?? EMPTY_BUS_SUMMARY, {
            journeys: (count: number) => t("bus:summary.journeys", { count }),
            operators: (count: number) => t("bus:summary.operators", { count }),
            stations: (count: number) => t("bus:summary.stations", { count }),
            withoutOperator: (count: number) => t("bus:summary.withoutOperator", { count }),
          })}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadFailed || summary === null}
        />
        <p className="mb-4 text-xs text-(--text-muted)">
          {t("bus:subtitle")} {t("bus:betaNote", { add })}
        </p>

        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: t("bus:search") }}
          status={{
            label: t("bus:list.filterStatus"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as BusStatus | "all"),
            allLabel: t("bus:list.allStatuses"),
            options: BUS_STATUSES.map((s) => ({ value: s, label: t(`bus:status.${s}`) })),
          }}
          year={{
            label: t("bus:list.filterYear"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("bus:list.allYears"),
            options: years.map((y) => ({ value: String(y), label: String(y) })),
          }}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={loading || loadFailed ? "" : t("common:filters.matching", { count: total })}
        />

        {loadFailed ? (
          <ListLoadFailed title={t("bus:loadError")} onRetry={reload} log={loadFailure} />
        ) : loading && rides.length === 0 ? (
          <SkeletonTable rows={10} />
        ) : rides.length === 0 ? (
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <ListEmptyState
              filtered={hasActiveFilter}
              emptyTitle={t("bus:empty", { add })}
              emptyHint={t("bus:list.emptyHint")}
              onReset={resetFilters}
            />
          </div>
        ) : (
          <>
            <TablePagination {...pagination} allowAll={false} placement="top" />
            <Table columns={columns} label={t("bus:title")} {...tableHints}>
              {rides.map((ride) => (
                <BusTableRow
                  key={ride.id}
                  journey={ride}
                  columns={columns}
                  onOpen={(): void => void navigate(`/bus/${ride.id}`)}
                  actions={
                    <RowActions>
                      <RowActionButton
                        icon="edit"
                        label={t("bus:edit")}
                        onClick={(): void => setEditing({ journey: ride })}
                      />
                      <RowActionButton
                        icon="delete"
                        label={t("bus:delete")}
                        onClick={(): void => setToDelete(ride)}
                      />
                    </RowActions>
                  }
                />
              ))}
            </Table>
            <TablePagination {...pagination} allowAll={false} />
            <p className="mt-2 px-1 text-xs text-(--text-muted)">
              {t("bus:list.sortedBy", {
                col: t(`bus:list.${sortBy === "departure" ? "time" : sortBy}`),
                dir: t(sortOrder === "asc" ? "bus:list.ascending" : "bus:list.descending"),
              })}
            </p>
          </>
        )}
      </div>

      {editing && (
        <BusFormModal
          journey={editing.journey}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <ConfirmModal
        isOpen={toDelete !== null}
        onClose={(): void => setToDelete(null)}
        onConfirm={(): void => void confirmDelete()}
        isLoading={deleting}
        title={t("bus:delete")}
        message={t("bus:deleteConfirm")}
        confirmText={t("common:buttons.delete")}
      />
    </AppShell>
  );
}

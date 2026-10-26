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
import { FerryFormModal } from "../components/ferry/FerryFormModal";
import {
  FerryTableRow,
  FERRY_COLUMN_LAYOUT,
  type FerryColumnId,
} from "../components/ferry/FerryTableRow";
import { railSummaryFigures } from "../lib/rail/railSummaryFigures";
import { ferryApi, type FerryListQuery, type FerryListSummary } from "../lib/api/ferry";
import { ferryYear } from "../shared/ferryCounting";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { ferryDeleteMessage } from "../lib/ferry/ferryDeleteMessage";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { FerryJourney, FerryStatus } from "../types/ferry";

const EMPTY_FERRY_SUMMARY: FerryListSummary = {
  journeys: 0,
  operators: 0,
  withoutOperator: 0,
  stations: 0,
};

const FERRY_STATUSES: readonly FerryStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];
const FERRY_COLUMN_IDS: readonly FerryColumnId[] = [
  "operator",
  "route",
  "time",
  "vessel",
  "duration",
  "distance",
  "status",
  "trip",
  "actions",
];
/** The mark, title, subtitle and pill a phone keeps, plus the actions. */
const FERRY_ALWAYS_VISIBLE = ["operator", "route", "time", "status", "actions"] as const;
const FERRY_SORT_FIELDS = ["departure", "distance", "created"] as const;
type FerrySortField = (typeof FERRY_SORT_FIELDS)[number];
/** The endpoint's page cap — one request covers the years of any realistic logbook. */
const YEAR_SCAN_LIMIT = 500;

type Filters = Pick<FerryListQuery, "q" | "status" | "year">;
type Editing = { journey: FerryJourney | null } | null;

/** Ferry logbook using the shared responsive table and filter controls. */
export default function FerryPage(): JSX.Element {
  const { t } = useTranslation(["ferry", "common"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [rides, setRides] = useState<FerryJourney[]>([]);
  const [total, setTotal] = useState(0);
  // Null until the server has counted: the strip then says nothing, not "0".
  const [summary, setSummary] = useState<FerryListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<FerryStatus | "all">("all");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<FerryJourney | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Asked only while the confirmation is open: deleting a ride takes its filed documents along.
  const documentCount = useDocumentCount(
    toDelete ? { type: "ferryJourney", id: toDelete.id } : null
  );
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback((): void => setReloadToken((n) => n + 1), []);
  const columnPrefs = useColumnPrefs("ferry-list", FERRY_ALWAYS_VISIBLE);
  const { sortBy, sortOrder, setSort } = useSortPrefs<FerrySortField>(
    "ferry-list",
    "departure",
    "desc",
    FERRY_SORT_FIELDS
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
  const pagination = useServerPagination(total, "ferry-list", signature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const page = await ferryApi.list({
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
        logger.error("FerryPage: failed to load rides", err);
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
        const all = await ferryApi.list({
          limit: YEAR_SCAN_LIMIT,
          sort: "departure",
          order: "desc",
        });
        if (!cancelled) {
          setYears([...new Set(all.journeys.map(ferryYear))].sort((a, b) => b - a));
        }
      } catch (err: unknown) {
        // The list works without them; the year select then offers "all" only.
        logger.error("FerryPage: failed to load the year options", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleSaved = (): void => {
    setEditing(null);
    addToast("success", t("ferry:saved"));
    reload();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await ferryApi.remove(toDelete.id);
      addToast("success", t("ferry:deleted"));
      setToDelete(null);
      reload();
    } catch (err: unknown) {
      logger.error("FerryPage: delete failed", err);
      addToast("error", t("ferry:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(
    () =>
      logbookColumns<FerryColumnId, FerrySortField>({
        ids: FERRY_COLUMN_IDS,
        layout: FERRY_COLUMN_LAYOUT,
        isVisible: columnPrefs.isVisible,
        label: (id) => t(`ferry:list.${id}`),
        sortKeyByColumn: { time: "departure", distance: "distance" },
        sortBy,
        sortOrder,
        onSort: (field) =>
          setSort(field, field === sortBy && sortOrder === "desc" ? "asc" : "desc"),
        sortAriaLabel: (col) => t("ferry:list.sortBy", { col }),
      }),
    [columnPrefs, t, sortBy, sortOrder, setSort]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
  };
  const hasActiveFilter = search.length > 0 || statusFilter !== "all" || yearFilter !== "all";
  const add = t("ferry:add");

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("ferry:title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={FERRY_COLUMN_IDS.map((id) => ({
                id,
                label: t(`ferry:list.${id}`),
                always: (FERRY_ALWAYS_VISIBLE as readonly string[]).includes(id),
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
          figures={railSummaryFigures(summary ?? EMPTY_FERRY_SUMMARY, {
            journeys: (count: number) => t("ferry:summary.journeys", { count }),
            operators: (count: number) => t("ferry:summary.operators", { count }),
            stations: (count: number) => t("ferry:summary.stations", { count }),
            withoutOperator: (count: number) => t("ferry:summary.withoutOperator", { count }),
          })}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadFailed || summary === null}
        />
        <p className="mb-4 text-xs text-(--text-muted)">
          {t("ferry:subtitle")} {t("ferry:pageNote")}
        </p>

        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: t("ferry:search") }}
          status={{
            label: t("ferry:list.filterStatus"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as FerryStatus | "all"),
            allLabel: t("ferry:list.allStatuses"),
            options: FERRY_STATUSES.map((s) => ({ value: s, label: t(`ferry:status.${s}`) })),
          }}
          year={{
            label: t("ferry:list.filterYear"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("ferry:list.allYears"),
            options: years.map((y) => ({ value: String(y), label: String(y) })),
          }}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={loading || loadFailed ? "" : t("common:filters.matching", { count: total })}
        />

        {loadFailed ? (
          <ListLoadFailed title={t("ferry:loadError")} onRetry={reload} log={loadFailure} />
        ) : loading && rides.length === 0 ? (
          <SkeletonTable rows={10} />
        ) : rides.length === 0 ? (
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <ListEmptyState
              filtered={hasActiveFilter}
              emptyTitle={t("ferry:empty", { add })}
              emptyHint={t("ferry:list.emptyHint")}
              onReset={resetFilters}
              // A genuinely empty logbook offers its next step right here
              // (forgejo#250); a filtered one offers only the reset.
              action={{ label: add, onClick: (): void => setEditing({ journey: null }) }}
            />
          </div>
        ) : (
          <>
            <TablePagination {...pagination} allowAll={false} placement="top" />
            <Table columns={columns} label={t("ferry:title")} {...tableHints}>
              {rides.map((ride) => (
                <FerryTableRow
                  key={ride.id}
                  journey={ride}
                  columns={columns}
                  onOpen={(): void => void navigate(`/ferry/${ride.id}`)}
                  actions={
                    <RowActions>
                      <RowActionButton
                        icon="edit"
                        label={t("ferry:edit")}
                        onClick={(): void => setEditing({ journey: ride })}
                      />
                      <RowActionButton
                        icon="delete"
                        label={t("ferry:delete")}
                        onClick={(): void => setToDelete(ride)}
                      />
                    </RowActions>
                  }
                />
              ))}
            </Table>
            <TablePagination {...pagination} allowAll={false} />
            <p className="mt-2 px-1 text-xs text-(--text-muted)">
              {t("ferry:list.sortedBy", {
                col: t(`ferry:list.${sortBy === "departure" ? "time" : sortBy}`),
                dir: t(sortOrder === "asc" ? "ferry:list.ascending" : "ferry:list.descending"),
              })}
            </p>
          </>
        )}
      </div>

      {editing && (
        <FerryFormModal
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
        title={t("ferry:delete")}
        message={toDelete ? ferryDeleteMessage(t, toDelete, documentCount) : ""}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}

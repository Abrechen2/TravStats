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
import { ColumnPicker } from "../components/table/ColumnPicker";
import TablePagination from "../components/table/TablePagination";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { logbookColumns } from "../components/table/logbookColumns";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import { useServerPagination } from "../components/table/useServerPagination";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { SkeletonTable } from "../components/SkeletonLoader";
import { railSummaryFigures } from "../lib/rail/railSummaryFigures";
import ConfirmModal from "../components/Training/ConfirmModal";
import { RailFormModal } from "../components/rail/RailFormModal";
import {
  RailTableRow,
  RAIL_COLUMN_LAYOUT,
  type RailColumnId,
} from "../components/rail/RailTableRow";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useRailImportAdapter } from "../components/import/adapters/railAdapter";
import { LoyaltyFilterNotice, useLoyaltyListFilter } from "../components/Loyalty/LoyaltyListFilter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTranslation } from "../hooks/useTranslation";
import {
  railApi,
  type RailConnectionPage,
  type RailListQuery,
  type RailListSummary,
} from "../lib/api/rail";

const EMPTY_RAIL_SUMMARY: RailListSummary = {
  journeys: 0,
  operators: 0,
  withoutOperator: 0,
  stations: 0,
};
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RailConnection, RailJourney, RailStatus } from "../types/rail";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";

const RAIL_STATUSES: readonly RailStatus[] = ["scheduled", "in_progress", "completed", "cancelled"];
const RAIL_COLUMN_IDS: readonly RailColumnId[] = [
  "operator",
  "route",
  "time",
  "train",
  "duration",
  "distance",
  "status",
  "trip",
  "actions",
];
/** The mark, title, subtitle and pill a phone keeps, plus the actions. */
const RAIL_ALWAYS_VISIBLE = ["operator", "route", "time", "status", "actions"] as const;
/** A ride has one order — its first departure (`GET /rail/connections`). */
const RAIL_SORT_FIELDS = ["departure"] as const;
type RailSortField = (typeof RAIL_SORT_FIELDS)[number];

type Filters = Pick<RailListQuery, "q" | "status" | "year">;
type Editing = { journey: RailJourney | null } | null;

/**
 * One page of the logbook. Normally the server's connections (forgejo#187): a
 * ride with changes is one entry, and a page never cuts one. Opened from a
 * loyalty card's figure the list shows the rides the card COUNTED — trains,
 * one by one — so that view keeps the leg list, each train an entry of its own.
 */
async function loadPage(
  filters: Filters,
  membershipId: string | null,
  linkedYear: number | null,
  page: { limit: number; offset: number; order: "asc" | "desc" }
): Promise<RailConnectionPage> {
  if (membershipId === null) return railApi.listConnections({ ...filters, ...page });
  const result = await railApi.list({
    ...filters,
    year: filters.year ?? linkedYear ?? undefined,
    membershipId,
    sort: "departure",
    ...page,
  });
  return {
    connections: result.journeys.map((journey) => ({ id: journey.id, legs: [journey] })),
    total: result.total,
    summary: result.summary,
  };
}

/**
 * The rail logbook — phase 1 of docs/superpowers/specs/2026-09-25-rail-domain.md,
 * in the layout every logbook shares since forgejo#197: title and the add
 * button, the summary strip, the filter bar, a server-paged table. The route
 * is gated twice (beta switch + domain choice) in App.tsx.
 */
export default function RailPage(): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  // One entry per ride; `total` counts entries, which is what the pager pages over.
  const [entries, setEntries] = useState<RailConnection[]>([]);
  const [total, setTotal] = useState(0);
  // Null until the server has counted: the strip then says nothing, not "0".
  const [summary, setSummary] = useState<RailListSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<RailStatus | "all">("all");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<RailJourney | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(async (): Promise<void> => setReloadToken((n) => n + 1), []);
  const railAdapter = useRailImportAdapter();
  const columnPrefs = useColumnPrefs("rail-list", RAIL_ALWAYS_VISIBLE);
  const { sortBy, sortOrder, setSort } = useSortPrefs<RailSortField>(
    "rail-list",
    "departure",
    "desc",
    RAIL_SORT_FIELDS
  );
  // A rail card's figure opens this list on the rides it counted
  // (`?membership=…&year=…`); the notice names the card and the year.
  const loyaltyFilter = useLoyaltyListFilter();
  const { membershipId, linkedYear } = loyaltyFilter;

  const filters = useMemo<Filters>(() => {
    const needle = debouncedSearch.trim().slice(0, SEARCH_MAX_LENGTH);
    return {
      ...(needle && { q: needle }),
      ...(statusFilter !== "all" && { status: statusFilter }),
      ...(yearFilter !== "all" && { year: yearFilter }),
    };
  }, [debouncedSearch, statusFilter, yearFilter]);
  const signature = `${filters.q ?? ""}|${filters.status ?? ""}|${filters.year ?? ""}|${membershipId ?? ""}`;
  const pagination = useServerPagination(total, "rail-list", signature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const page = await loadPage(filters, membershipId, linkedYear, {
          limit,
          offset,
          order: sortOrder,
        });
        if (cancelled) return;
        setEntries(page.connections);
        setTotal(page.total);
        setSummary(page.summary ?? null);
        setLoadFailed(false);
      } catch (err: unknown) {
        if (cancelled) return;
        // A failed load is said, never drawn as an empty logbook.
        logger.error("RailPage: failed to load journeys", err);
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
  }, [filters, membershipId, linkedYear, limit, offset, sortOrder, reloadToken]);

  // The year options: every year the account rode in, not just the filtered
  // set's — picking a year must not take the other years off the list.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const stats = await railApi.stats();
        if (!cancelled) setYears(stats.byYear.map((row) => row.year).sort((a, b) => b - a));
      } catch (err: unknown) {
        // The list works without them; the year select then offers "all" only.
        logger.error("RailPage: failed to load the year options", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleSaved = async (): Promise<void> => {
    setEditing(null);
    addToast("success", t("rail:saved"));
    await reload();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await railApi.remove(toDelete.id);
      addToast("success", t("rail:deleted"));
      setToDelete(null);
      await reload();
    } catch (err: unknown) {
      logger.error("RailPage: delete failed", err);
      addToast("error", t("rail:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(
    () =>
      logbookColumns<RailColumnId, RailSortField>({
        ids: RAIL_COLUMN_IDS,
        layout: RAIL_COLUMN_LAYOUT,
        isVisible: columnPrefs.isVisible,
        label: (id) => t(`rail:list.columns.${id}`),
        sortKeyByColumn: { time: "departure" },
        sortBy,
        sortOrder,
        onSort: () => setSort("departure", sortOrder === "asc" ? "desc" : "asc"),
        sortAriaLabel: (col) => t("rail:list.sortBy", { col }),
      }),
    [columnPrefs, t, sortBy, sortOrder, setSort]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
  };
  const hasActiveFilter = search.length > 0 || statusFilter !== "all" || yearFilter !== "all";

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("rail:title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={RAIL_COLUMN_IDS.map((id) => ({
                id,
                label: t(`rail:list.columns.${id}`),
                always: (RAIL_ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            <button
              type="button"
              onClick={(): void => setAdding(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("rail:add")}</span>
            </button>
          </div>
        </div>

        {/* The strip counts TRAINS in the whole filtered list, not rides (forgejo#187). */}
        <ListSummaryStrip
          figures={railSummaryFigures(summary ?? EMPTY_RAIL_SUMMARY, {
            journeys: (count: number) => t("rail:summary.journeys", { count }),
            operators: (count: number) => t("rail:summary.operators", { count }),
            stations: (count: number) => t("rail:summary.stations", { count }),
            withoutOperator: (count: number) => t("rail:summary.withoutOperator", { count }),
          })}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadFailed || summary === null}
        />
        <p className="mb-4 text-xs text-(--text-muted)">
          {t("rail:subtitle")} {t("rail:betaNote")}
        </p>
        {membershipId !== null && (
          <div className="mb-3">
            <LoyaltyFilterNotice
              membershipId={membershipId}
              year={linkedYear}
              onClear={loyaltyFilter.clear}
            />
          </div>
        )}

        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: t("rail:search") }}
          status={{
            label: t("rail:list.filterStatus"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as RailStatus | "all"),
            allLabel: t("rail:list.allStatuses"),
            options: RAIL_STATUSES.map((s) => ({ value: s, label: t(`rail:status.${s}`) })),
          }}
          year={{
            label: t("rail:list.filterYear"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("rail:list.allYears"),
            options: years.map((y) => ({ value: String(y), label: String(y) })),
          }}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={loading || loadFailed ? "" : t("common:filters.matching", { count: total })}
        />

        {loadFailed ? (
          <ListLoadFailed
            title={t("rail:loadError")}
            onRetry={(): void => void reload()}
            log={loadFailure}
          />
        ) : loading && entries.length === 0 ? (
          <SkeletonTable rows={10} />
        ) : entries.length === 0 ? (
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <ListEmptyState
              filtered={hasActiveFilter}
              emptyTitle={t("rail:empty")}
              emptyHint={t("rail:list.emptyHint")}
              onReset={resetFilters}
            />
          </div>
        ) : (
          <>
            <TablePagination {...pagination} allowAll={false} placement="top" />
            <Table columns={columns} label={t("rail:title")} {...tableHints}>
              {entries.map((entry) => {
                const single = entry.legs.length === 1 ? entry.legs[0] : null;
                return (
                  <RailTableRow
                    key={entry.id}
                    connection={entry}
                    columns={columns}
                    onOpen={(): void =>
                      void navigate(single ? `/rail/${single.id}` : `/rail/connection/${entry.id}`)
                    }
                    actions={
                      single ? (
                        <RowActions>
                          <RowActionButton
                            icon="edit"
                            label={t("rail:edit")}
                            onClick={(): void => setEditing({ journey: single })}
                          />
                          <RowActionButton
                            icon="delete"
                            label={t("rail:delete")}
                            onClick={(): void => setToDelete(single)}
                          />
                        </RowActions>
                      ) : null
                    }
                  />
                );
              })}
            </Table>
            <TablePagination {...pagination} allowAll={false} />
            <p className="mt-2 px-1 text-xs text-(--text-muted)">
              {t("rail:list.sortedBy", {
                col: t("rail:list.columns.time"),
                dir: t(sortOrder === "asc" ? "rail:list.ascending" : "rail:list.descending"),
              })}
            </p>
          </>
        )}
      </div>

      {/* New rides start at the chooser: a ticket to read, or typing it in. */}
      <DomainImportPanel
        open={adding}
        onClose={(): void => setAdding(false)}
        onItemsCreated={reload}
        adapter={railAdapter}
      />
      {editing && (
        <RailFormModal
          journey={editing.journey}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
          onProgress={reload}
        />
      )}
      <ConfirmModal
        isOpen={toDelete !== null}
        onClose={(): void => setToDelete(null)}
        onConfirm={(): void => void confirmDelete()}
        isLoading={deleting}
        title={t("rail:delete")}
        message={t("rail:deleteConfirm")}
        confirmText={t("common:buttons.delete")}
      />
    </AppShell>
  );
}

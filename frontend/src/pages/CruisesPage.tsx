import AppShell from "../components/ui/AppShell";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise, CruiseStatus } from "../types";
import {
  CruiseRow,
  CRUISE_COLUMN_LAYOUT,
  type CruiseColumnId,
} from "../components/Cruise/CruiseRow";
import { Table, type TableColumn } from "../components/ui/Table";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ConfirmModal from "../components/Training/ConfirmModal";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import ListFilterBar, {
  FilterField,
  PANEL_SELECT_CLASS,
  SEARCH_MAX_LENGTH,
} from "../components/table/ListFilterBar";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import CruiseRowActions from "../components/Cruise/CruiseRowActions";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useCruiseImportAdapter } from "../components/import/adapters/cruiseAdapter";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { SkeletonTable } from "../components/SkeletonLoader";
import { useTranslation } from "../hooks/useTranslation";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { countPortCalls } from "../components/Cruise/cruisePorts";
import type { CruiseFacets, CruiseListQuery } from "../lib/api/cruise";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { CRUISE_SORT_FIELDS, type CruiseSortField } from "../shared/cruiseListOrder";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { useServerPagination } from "../components/table/useServerPagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import TablePagination from "../components/table/TablePagination";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";

type StatusFilter = CruiseStatus | "all";
type YearFilter = number | "all";

// #status-from-dates: in_progress included so the filter dropdown can
// discover cruises currently under way, not just scheduled/flown/cancelled.
const STATUSES: CruiseStatus[] = ["scheduled", "in_progress", "flown", "cancelled", "historical"];

// Column-visibility ids (ColumnPicker) — header and CruiseRow must agree.
const CRUISE_COLUMN_IDS: readonly CruiseColumnId[] = [
  "ship",
  "line",
  "dates",
  "ports",
  "status",
  "cabin",
  "price",
  "trip",
  "actions",
];
/**
 * Not hideable. `ship`, `dates` and `status` are the three the row keeps when
 * the table collapses at 390px — hiding one on a desktop would take it off the
 * phone too, because a hidden column has no cell to collapse. `actions` was
 * always here. See `components/table/narrowColumns.ts`.
 */
const CRUISE_ALWAYS_VISIBLE = ["ship", "dates", "status", "actions"] as const;
/** Sort key -> column id, so the footer can name the column the way the
 *  header and the picker do rather than keeping its own copy. */
const SORT_KEY_TO_COLUMN: Partial<Record<string, CruiseColumnId>> = {
  ship: "ship",
  line: "line",
  date: "dates",
  ports: "ports",
  status: "status",
  price: "price",
};

/**
 * Column id -> sort key. Mostly identity; `dates` sorts on `date`, and the
 * two columns that carry no key (cabin, actions) are not sortable.
 */
const CRUISE_SORT_KEY_BY_COLUMN: Partial<Record<CruiseColumnId, CruiseSortField>> = {
  ship: "ship",
  line: "line",
  dates: "date",
  ports: "ports",
  status: "status",
  price: "price",
};

export default function CruisesPage(): JSX.Element {
  const { t } = useTranslation(["cruise", "common", "settings"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [facets, setFacets] = useState<CruiseFacets | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const importAdapter = useCruiseImportAdapter();
  const [editingCruise, setEditingCruise] = useState<Cruise | null>(null);
  const [cruiseToDelete, setCruiseToDelete] = useState<Cruise | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [duplicateSource, setDuplicateSource] = useState<Cruise | null>(null);

  // Filter state — mirrors the flights filter panel conceptually but the
  // data domain is smaller so we inline rather than reuse <Filters />.
  const [search, setSearch] = useState<string>("");
  // Debounced: the search used to filter rows already in the browser, so
  // typing cost nothing. As a query parameter, "AIDAnova" is eight requests
  // without this, seven for a prefix nobody wanted to see.
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  // The one filter only cruises have. It lives behind the "Filter" button,
  // which is what that button is for — search/status/year stay open because
  // every domain has them.
  const [lineFilter, setLineFilter] = useState<string>("all");
  // Newest first everywhere, and the choice survives a reload — the
  // column choice already did (useColumnPrefs), the sort never had.
  // The vocabulary comes from the mirror the SERVER also reads, so a key the
  // header offers cannot be one the server rejects.
  const { sortBy, sortOrder, setSort } = useSortPrefs(
    "cruises-list",
    "date",
    "desc",
    CRUISE_SORT_FIELDS
  );
  const columnPrefs = useColumnPrefs("cruise-list", CRUISE_ALWAYS_VISIBLE);

  const handleSort = (col: CruiseSortField): void => {
    if (col === sortBy) {
      setSort(col, sortOrder === "asc" ? "desc" : "asc");
    } else {
      // date/price/ports default to desc (biggest/newest first); text asc.
      setSort(col, col === "ship" || col === "line" || col === "status" ? "asc" : "desc");
    }
  };

  /** Ship name, falling back to the free-text override the parser may set. */
  const cruiseName = (c: Cruise): string =>
    c.ship?.name ?? c.shipNameOverride ?? t("list.unnamedShip");

  const confirmDelete = async (): Promise<void> => {
    if (!cruiseToDelete) return;
    setDeleting(true);
    try {
      await cruiseApi.remove(cruiseToDelete.id);
      addToast("success", t("list.delete.done"));
      setCruiseToDelete(null);
      await reload();
    } catch (err: unknown) {
      logger.error("CruisesPage: delete failed", err);
      addToast("error", t("list.delete.error"));
    } finally {
      setDeleting(false);
    }
  };

  const startDuplicate = (c: Cruise): void => {
    // Copy everything but identity + dates + booking ref, so the user sets new
    // dates. Also reset status so the copy isn't pre-marked flown/cancelled.
    // CruiseEditModal(create) seeds its form from this and calls create().
    setDuplicateSource({
      ...c,
      startDate: null,
      endDate: null,
      bookingReference: null,
      status: "scheduled",
    });
  };

  /** Bumped after a create, edit, duplicate or delete — the only reason to
   *  ask the server for the same page and the same counts twice. */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(async (): Promise<void> => {
    setReloadToken((n) => n + 1);
  }, []);

  /**
   * The filter bar's answers as ONE value, so the query, the effect
   * dependencies and the pager's reset key cannot drift apart.
   */
  const filterQuery = useMemo<CruiseListQuery>(() => {
    const query: CruiseListQuery = {};
    const needle = debouncedSearch.trim().slice(0, SEARCH_MAX_LENGTH);
    if (needle) query.q = needle;
    if (statusFilter !== "all") query.status = statusFilter;
    if (yearFilter !== "all") query.year = yearFilter;
    // `shipLine`, not `cruiseLine`: the dropdown lists the line a row DRAWS,
    // which falls back to the ship's, and the column filter cannot see that.
    if (lineFilter !== "all") query.shipLine = lineFilter;
    return query;
  }, [debouncedSearch, statusFilter, yearFilter, lineFilter]);
  const filterSignature = useMemo(
    () =>
      Object.keys(filterQuery)
        .sort()
        .map((key) => `${key}=${String((filterQuery as Record<string, unknown>)[key])}`)
        .join("&"),
    [filterQuery]
  );

  const pagination = useServerPagination(total, "cruises-list", filterSignature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setLoadError(false);
      try {
        const page = await cruiseApi.listPage({
          ...filterQuery,
          sort: sortBy,
          order: sortOrder,
          limit,
          offset,
        });
        if (cancelled) return;
        setCruises(page.items);
        setTotal(page.total);
      } catch (err) {
        if (cancelled) return;
        // Without this the list simply stayed empty on a network failure —
        // indistinguishable from an account that has no cruises yet.
        logger.error("CruisesPage: failed to load cruises", err);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterQuery, sortBy, sortOrder, limit, offset, reloadToken]);

  // The option lists and the summary figures. Separate from the page fetch on
  // purpose: paging and re-sorting change none of these numbers, and asking
  // again would make every page turn cost two passes over the filtered set.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const data = await cruiseApi.facets(filterQuery);
        if (!cancelled) setFacets(data);
      } catch (err) {
        // The table still works without them; the strip and the dropdowns go
        // quiet rather than showing counts nobody measured.
        logger.error("CruisesPage: failed to load cruise facets", err);
        if (!cancelled) setFacets(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterQuery, reloadToken]);

  // Year options come from ALL loaded cruises (`cruises`), never from the
  // filtered set — otherwise picking a year would remove the other years from
  // the dropdown, leaving the choice changeable only by resetting. It reads
  // from the full list already; the note is here so it stays that way.
  /** Counted by the database under every OTHER filter, so picking a line no
   *  longer leaves the line list holding only that line. */
  const availableYears = useMemo(() => (facets?.years ?? []).map((y) => y.value), [facets]);
  const availableLines = useMemo(() => (facets?.lines ?? []).map((l) => l.value), [facets]);

  /**
   * The visible columns, in order, with their narrow places and their sort
   * headers. One list feeds the head and every row, so a cell can no longer
   * land under the wrong column — the failure the old `isColumnVisible` pair
   * made possible, where the header and the row each filtered separately.
   */
  const visibleColumns = useMemo<TableColumn[]>(
    () =>
      CRUISE_COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
        const layout = CRUISE_COLUMN_LAYOUT[id];
        const label = t(`list.columns.${id}`);
        const sortKey = CRUISE_SORT_KEY_BY_COLUMN[id];
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
                ariaLabel={t("list.sortBy", { col: label })}
              >
                {label}
              </SortableHeader>
            ),
        };
      }),
    [columnPrefs, t, sortBy, sortOrder, handleSort]
  );

  /**
   * The four figures above the table, read off the server's own counts.
   *
   * They were folded from the rows the browser held, which is the reason it
   * held them: a strip that describes the whole filtered set cannot be
   * computed from one page. `portCalls` is still the count of TIMES a ship
   * tied up, not of places — the different question `countUniquePorts`
   * answers for the row cell.
   */
  const summaryFigures = useMemo(() => {
    if (facets === null) return [];
    const { summary } = facets;
    return [
      { key: "cruises", value: String(summary.cruises), label: t("common:summary.cruises") },
      { key: "portCalls", value: String(summary.portCalls), label: t("common:summary.portCalls") },
      { key: "seaDays", value: String(summary.seaDays), label: t("common:summary.seaDays") },
      { key: "lines", value: String(summary.lines), label: t("common:summary.lines") },
    ];
  }, [facets, t]);

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
    setLineFilter("all");
  };

  const extraActiveCount = lineFilter === "all" ? 0 : 1;
  const hasActiveFilter =
    search.length > 0 || statusFilter !== "all" || yearFilter !== "all" || extraActiveCount > 0;

  return (
    <AppShell width="table">
      <LogbookTabs />
      {/* The width is the shell's now — `table`, the same one every logbook
          page asks for by name. */}
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("list.title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={CRUISE_COLUMN_IDS.map((id) => ({
                id,
                label: t(`list.columns.${id}`),
                always: (CRUISE_ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("add.title")}</span>
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
          {t("list.wholeListHint")}{" "}
          <Link
            to="/settings?section=import"
            className="underline underline-offset-4 hover:text-(--text-primary)"
          >
            {t("settings:import.openHub")}
          </Link>
        </p>

        <ListFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("filter.searchPlaceholder"),
          }}
          status={{
            label: t("filter.status"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as StatusFilter),
            allLabel: t("filter.allStatuses"),
            options: STATUSES.map((st) => ({ value: st, label: t(`status.${st}`) })),
          }}
          year={{
            label: t("filter.year"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("filter.allYears"),
            options: availableYears.map((y) => ({ value: String(y), label: String(y) })),
          }}
          extraActiveCount={extraActiveCount}
          extra={
            <FilterField label={t("filter.line")}>
              <select
                value={lineFilter}
                onChange={(e): void => setLineFilter(e.target.value)}
                className={PANEL_SELECT_CLASS}
              >
                <option value="all">{t("filter.allLines")}</option>
                {availableLines.map((line) => (
                  <option key={line} value={line}>
                    {line}
                  </option>
                ))}
              </select>
            </FilterField>
          }
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={loading || loadError ? "" : t("common:filters.matching", { count: total })}
        />

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("list.loadError")}
          </div>
        ) : loading ? (
          <SkeletonTable rows={10} />
        ) : cruises.length === 0 ? (
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <ListEmptyState
              filtered={hasActiveFilter}
              emptyTitle={t("list.empty")}
              emptyHint={t("list.emptyHint")}
              onReset={resetFilters}
            />
          </div>
        ) : (
          <>
            <TablePagination {...pagination} allowAll={false} placement="top" />
            <Table columns={visibleColumns} label={t("list.title")} {...tableHints}>
              {cruises.map((c) => (
                <CruiseRow
                  key={c.id}
                  cruise={c}
                  columns={visibleColumns}
                  onOpen={() => navigate(`/cruises/${c.id}`)}
                  actions={
                    <CruiseRowActions
                      cruise={c}
                      onEdit={setEditingCruise}
                      onDuplicate={startDuplicate}
                      onDelete={() => setCruiseToDelete(c)}
                    />
                  }
                />
              ))}
            </Table>
            {/* `allowAll` is off: over a network "Alle" would promise a row
                count nobody has checked — see `useServerPagination`. */}
            <TablePagination {...pagination} allowAll={false} />
            {/* Same closing line the flights and lodging tables carry: how many
                rows, and what they are sorted by. The count used to sit only in
                the filter bar, so the table simply stopped. */}
            <p className="mt-2 px-1 text-xs text-(--text-muted)">
              {t("list.sortedBy", {
                col: t(`list.columns.${SORT_KEY_TO_COLUMN[sortBy] ?? sortBy}`),
                dir: t(sortOrder === "asc" ? "list.ascending" : "list.descending"),
              })}
            </p>
          </>
        )}

        {/* Cruises had their own chooser, built before the shared one existed
            — a third copy of the same idea, with the drop zone hidden behind a
            button that swapped the view. Same rows as every other area now. */}
        <DomainImportPanel
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onItemsCreated={reload}
          adapter={importAdapter}
        />
        {editingCruise && (
          <CruiseEditModal
            mode="edit"
            cruise={editingCruise}
            onClose={() => setEditingCruise(null)}
            onSaved={async () => {
              setEditingCruise(null);
              await reload();
            }}
          />
        )}
        {duplicateSource && (
          <CruiseEditModal
            mode="create"
            cruise={duplicateSource}
            onClose={() => setDuplicateSource(null)}
            onSaved={async () => {
              setDuplicateSource(null);
              await reload();
            }}
          />
        )}
        {/* The same dialog, the same sentence and the same keys the cruise
            DETAIL page uses. Deleting a cruise used to read differently
            depending on which of the two you were standing on — and the
            version here never mentioned that it was permanent. */}
        <ConfirmModal
          isOpen={cruiseToDelete !== null}
          onClose={() => setCruiseToDelete(null)}
          onConfirm={() => void confirmDelete()}
          isLoading={deleting}
          title={t("detail.deleteConfirmTitle")}
          message={
            cruiseToDelete
              ? countedDeleteMessage(
                  t,
                  {
                    counted: "cruise:detail.deleteConfirmMessage",
                    empty: "cruise:detail.deleteConfirmMessageNoStops",
                  },
                  cruiseName(cruiseToDelete),
                  countPortCalls(cruiseToDelete)
                )
              : ""
          }
          confirmText={t("common:buttons.delete")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      </div>
    </AppShell>
  );
}

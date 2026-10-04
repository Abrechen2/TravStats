import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { Table } from "../components/ui/Table";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import ListFilterBar, {
  FilterField,
  PANEL_SELECT_CLASS,
  SEARCH_MAX_LENGTH,
} from "../components/table/ListFilterBar";
import { ColumnPicker } from "../components/table/ColumnPicker";
import TablePagination from "../components/table/TablePagination";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { logbookColumns } from "../components/table/logbookColumns";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import { useServerPagination } from "../components/table/useServerPagination";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { SkeletonTable } from "../components/SkeletonLoader";
import ConfirmModal from "../components/Training/ConfirmModal";
import { RentalFormModal } from "../components/rental/RentalFormModal";
import {
  RentalTableRow,
  RENTAL_COLUMN_LAYOUT,
  type RentalColumnId,
} from "../components/rental/RentalTableRow";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useRentalImportAdapter } from "../components/import/adapters/rentalAdapter";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTranslation } from "../hooks/useTranslation";
import { rentalApi, type RentalListQuery } from "../lib/api/rental";
import { rentalLinksApi } from "../lib/api/rentalLinks";
import { rentalSummaryFigures } from "../lib/rental/rentalSummaryFigures";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RentalBooking, RentalStatus } from "../types/rental";

const RENTAL_STATUSES: readonly RentalStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];
const RENTAL_COLUMN_IDS: readonly RentalColumnId[] = [
  "provider",
  "route",
  "period",
  "vehicle",
  "km",
  "status",
  "trip",
  "actions",
];
/** The mark, title, subtitle and pill a phone keeps, plus the actions. */
const RENTAL_ALWAYS_VISIBLE = ["provider", "route", "period", "status", "actions"] as const;
const RENTAL_SORT_FIELDS = ["pickup"] as const;
type RentalSortField = (typeof RENTAL_SORT_FIELDS)[number];

type Filters = Pick<RentalListQuery, "q" | "status" | "year" | "provider">;
type Editing = { rental: RentalBooking | null } | null;

/** The year and provider options: every one the account has, not just the filtered set's. */
interface Options {
  years: number[];
  providers: string[];
}

/**
 * The rental logbook — package R1 of
 * docs/superpowers/specs/2026-10-01-rental-domain-design.md, in the layout
 * every logbook shares since forgejo#197: title and the add button, the
 * summary strip, the filter bar, a server-paged table. Gated twice (beta
 * switch + domain choice) in App.tsx.
 */
export default function RentalsPage(): JSX.Element {
  const { t } = useTranslation(["rental", "common"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [rentals, setRentals] = useState<RentalBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [options, setOptions] = useState<Options>({ years: [], providers: [] });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] = useState<RentalStatus | "all">("all");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<RentalBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(async (): Promise<void> => setReloadToken((n) => n + 1), []);
  const rentalAdapter = useRentalImportAdapter();
  const columnPrefs = useColumnPrefs("rental-list", RENTAL_ALWAYS_VISIBLE);
  const { sortBy, sortOrder, setSort } = useSortPrefs<RentalSortField>(
    "rental-list",
    "pickup",
    "desc",
    RENTAL_SORT_FIELDS
  );

  const filters = useMemo<Filters>(() => {
    const needle = debouncedSearch.trim().slice(0, SEARCH_MAX_LENGTH);
    return {
      ...(needle && { q: needle }),
      ...(statusFilter !== "all" && { status: statusFilter }),
      ...(yearFilter !== "all" && { year: yearFilter }),
      ...(providerFilter !== "all" && { provider: providerFilter }),
    };
  }, [debouncedSearch, statusFilter, yearFilter, providerFilter]);
  const signature = [filters.q, filters.status, filters.year, filters.provider].join("|");
  const pagination = useServerPagination(total, "rental-list", signature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const page = await rentalApi.list({
          ...filters,
          sort: sortBy,
          order: sortOrder,
          limit,
          offset,
        });
        if (cancelled) return;
        setRentals(page.rentals);
        setTotal(page.total);
        setLoadFailed(false);
      } catch (err: unknown) {
        if (cancelled) return;
        // A failed load is said, never drawn as an empty logbook.
        logger.error("RentalsPage: failed to load rentals", err);
        setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filters, sortBy, sortOrder, limit, offset, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const stats = await rentalLinksApi.stats();
        if (cancelled) return;
        setOptions({
          years: stats.byYear.map((row) => row.year).sort((a, b) => b - a),
          providers: stats.providers.map((row) => row.provider),
        });
      } catch (err: unknown) {
        // The list works without them; the selects then offer "all" only.
        logger.error("RentalsPage: failed to load the filter options", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleSaved = async (): Promise<void> => {
    setEditing(null);
    addToast("success", t("rental:saved"));
    await reload();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await rentalApi.remove(toDelete.id);
      addToast("success", t("rental:deleted"));
      setToDelete(null);
      await reload();
    } catch (err: unknown) {
      logger.error("RentalsPage: delete failed", err);
      addToast("error", t("rental:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(
    () =>
      logbookColumns<RentalColumnId, RentalSortField>({
        ids: RENTAL_COLUMN_IDS,
        layout: RENTAL_COLUMN_LAYOUT,
        isVisible: columnPrefs.isVisible,
        label: (id) => t(`rental:list.columns.${id}`),
        sortKeyByColumn: { period: "pickup" },
        sortBy,
        sortOrder,
        onSort: () => setSort("pickup", sortOrder === "asc" ? "desc" : "asc"),
        sortAriaLabel: (col) => t("rental:list.sortBy", { col }),
      }),
    [columnPrefs, t, sortBy, sortOrder, setSort]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
    setProviderFilter("all");
  };
  const extraActiveCount = providerFilter === "all" ? 0 : 1;
  const hasActiveFilter =
    search.length > 0 || statusFilter !== "all" || yearFilter !== "all" || extraActiveCount > 0;

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("rental:title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={RENTAL_COLUMN_IDS.map((id) => ({
                id,
                label: t(`rental:list.columns.${id}`),
                always: (RENTAL_ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            <button
              type="button"
              onClick={(): void => setAdding(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("rental:add")}</span>
            </button>
          </div>
        </div>

        <ListSummaryStrip
          figures={rentalSummaryFigures(rentals, {
            rentals: (count: number) => t("rental:summary.rentals", { count }),
            days: (count: number) => t("rental:summary.days", { count }),
            providers: (count: number) => t("rental:summary.providers", { count }),
          })}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadFailed}
        />
        <p className="mb-4 text-xs text-(--text-muted)">
          {t("rental:subtitle")} {t("rental:betaNote")}
        </p>

        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: t("rental:search") }}
          status={{
            label: t("rental:list.filterStatus"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as RentalStatus | "all"),
            allLabel: t("rental:list.allStatuses"),
            options: RENTAL_STATUSES.map((s) => ({ value: s, label: t(`rental:status.${s}`) })),
          }}
          year={{
            label: t("rental:list.filterYear"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("rental:list.allYears"),
            options: options.years.map((y) => ({ value: String(y), label: String(y) })),
          }}
          extraActiveCount={extraActiveCount}
          extra={
            <FilterField label={t("rental:list.filterProvider")}>
              <select
                value={providerFilter}
                onChange={(e): void => setProviderFilter(e.target.value)}
                className={PANEL_SELECT_CLASS}
              >
                <option value="all">{t("rental:list.allProviders")}</option>
                {options.providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </FilterField>
          }
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={loading || loadFailed ? "" : t("common:filters.matching", { count: total })}
        />

        {loadFailed ? (
          <div
            role="alert"
            className="rounded-md border border-(--danger)/50 bg-(--danger)/10 px-4 py-4 text-sm text-(--danger)"
          >
            {t("rental:loadError")}
          </div>
        ) : loading && rentals.length === 0 ? (
          <SkeletonTable rows={10} />
        ) : rentals.length === 0 ? (
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <ListEmptyState
              filtered={hasActiveFilter}
              emptyTitle={t("rental:empty")}
              emptyHint={t("rental:list.emptyHint")}
              onReset={resetFilters}
            />
          </div>
        ) : (
          <>
            <TablePagination {...pagination} allowAll={false} placement="top" />
            <Table columns={columns} label={t("rental:title")} {...tableHints}>
              {rentals.map((rental) => (
                <RentalTableRow
                  key={rental.id}
                  rental={rental}
                  columns={columns}
                  onOpen={(): void => void navigate(`/rentals/${rental.id}`)}
                  actions={
                    <RowActions>
                      <RowActionButton
                        icon="edit"
                        label={t("rental:edit")}
                        onClick={(): void => setEditing({ rental })}
                      />
                      <RowActionButton
                        icon="delete"
                        label={t("rental:delete")}
                        onClick={(): void => setToDelete(rental)}
                      />
                    </RowActions>
                  }
                />
              ))}
            </Table>
            <TablePagination {...pagination} allowAll={false} />
            <p className="mt-2 px-1 text-xs text-(--text-muted)">
              {t("rental:list.sortedBy", {
                col: t("rental:list.columns.period"),
                dir: t(sortOrder === "asc" ? "rental:list.ascending" : "rental:list.descending"),
              })}
            </p>
          </>
        )}
      </div>

      {/* New rentals start at the chooser: a booking mail to read, or typing it in. */}
      <DomainImportPanel
        open={adding}
        onClose={(): void => setAdding(false)}
        onItemsCreated={reload}
        adapter={rentalAdapter}
      />
      {editing && (
        <RentalFormModal
          rental={editing.rental}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <ConfirmModal
        isOpen={toDelete !== null}
        onClose={(): void => setToDelete(null)}
        onConfirm={(): void => void confirmDelete()}
        isLoading={deleting}
        title={t("rental:delete")}
        message={t("rental:deleteConfirm")}
        confirmText={t("common:buttons.delete")}
      />
    </AppShell>
  );
}

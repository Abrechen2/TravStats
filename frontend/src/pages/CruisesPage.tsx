import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise, CruiseStatus } from "../types";
import { CruiseRow, type CruiseColumnId } from "../components/Cruise/CruiseRow";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ConfirmModal from "../components/Training/ConfirmModal";
import ListEmptyState from "../components/table/ListEmptyState";
import ListFilterBar, {
  FilterField,
  PANEL_SELECT_CLASS,
} from "../components/table/ListFilterBar";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import CruiseRowActions from "../components/Cruise/CruiseRowActions";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useCruiseImportAdapter } from "../components/import/adapters/cruiseAdapter";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";
import { useTranslation } from "../hooks/useTranslation";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { countPortCalls } from "../components/Cruise/cruisePorts";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { sortCruises, type CruiseSortKey, type SortOrder } from "../components/Cruise/sortCruises";

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
  "actions",
];
const CRUISE_ALWAYS_VISIBLE = ["ship", "actions"] as const;
/** Columns whose values line up on the right. */
const CRUISE_NUMERIC_COLUMNS: readonly CruiseColumnId[] = ["ports", "price"];
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
const CRUISE_SORT_KEY_BY_COLUMN: Partial<Record<CruiseColumnId, CruiseSortKey>> = {
  ship: "ship",
  line: "line",
  dates: "date",
  ports: "ports",
  status: "status",
  price: "price",
};

export default function CruisesPage(): JSX.Element {
  const { t } = useTranslation(["cruise", "common", "settings"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [cruises, setCruises] = useState<Cruise[]>([]);
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  // The one filter only cruises have. It lives behind the "Filter" button,
  // which is what that button is for — search/status/year stay open because
  // every domain has them.
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<CruiseSortKey>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const columnPrefs = useColumnPrefs("cruise-list", CRUISE_ALWAYS_VISIBLE);

  const handleSort = (col: CruiseSortKey): void => {
    if (col === sortBy) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      // date/price/ports default to desc (biggest/newest first); text asc.
      setSortOrder(col === "ship" || col === "line" || col === "status" ? "asc" : "desc");
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

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await cruiseApi.list();
      setCruises(data);
    } catch (err) {
      // Without this the list simply stayed empty on a network failure —
      // indistinguishable from an account that has no cruises yet.
      logger.error("CruisesPage: failed to load cruises", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Year options come from ALL loaded cruises (`cruises`), never from the
  // filtered set — otherwise picking a year would remove the other years from
  // the dropdown, leaving the choice changeable only by resetting. It reads
  // from the full list already; the note is here so it stays that way.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const c of cruises) {
      if (c.startDate) years.add(new Date(c.startDate).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cruises]);

  /** One entry per cruise line, read from the FULL list so the options do not
   *  shrink as the other filters narrow the table. */
  const availableLines = useMemo(() => {
    const names = new Set<string>();
    for (const c of cruises) {
      const line = c.cruiseLine ?? c.ship?.cruiseLine ?? "";
      if (line.trim().length > 0) names.add(line);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [cruises]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cruises.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (lineFilter !== "all" && (c.cruiseLine ?? c.ship?.cruiseLine ?? "") !== lineFilter) {
        return false;
      }
      if (yearFilter !== "all") {
        const year = c.startDate ? new Date(c.startDate).getFullYear() : null;
        if (year !== yearFilter) return false;
      }
      if (needle.length > 0) {
        const shipName = c.ship?.name ?? c.shipNameOverride ?? "";
        const line = c.cruiseLine ?? c.ship?.cruiseLine ?? "";
        const haystack = `${shipName} ${line}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [cruises, search, statusFilter, yearFilter, lineFilter]);

  const sorted = useMemo(
    () => sortCruises(filtered, sortBy, sortOrder),
    [filtered, sortBy, sortOrder]
  );

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
    <PageTransition>
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />

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
          onChange: (v): void =>
            setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
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
        resultLabel={t("common:filters.showing", { count: filtered.length })}
      />

      {/* Same width budget as the flights table page — owner principle:
          the domain list pages look the same, only the content differs. */}
      <div className="mx-auto max-w-(--breakpoint-2xl) px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-(--text-primary)">{t("list.title")}</h1>
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

        <p className="mb-4 text-xs text-(--text-muted)">
          {t("list.wholeListHint")}{" "}
          <Link
            to="/settings?section=import"
            className="underline underline-offset-4 hover:text-(--text-primary)"
          >
            {t("settings:import.openHub")}
          </Link>
        </p>

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("list.loadError")}
          </div>
        ) : loading ? (
          <SkeletonTable rows={10} />
        ) : filtered.length === 0 ? (
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
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead
                style={{
                  background: "var(--bg-elevated)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <tr>
                  {/*
                    One loop instead of six copied blocks. Each of those built
                    its own sort button — and showed ▼ for ascending, the
                    opposite of the shared component the lodging table uses.
                    The same sort state read differently depending on which
                    page you were on.
                  */}
                  {CRUISE_COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
                    const numeric = CRUISE_NUMERIC_COLUMNS.includes(id);
                    const label = t(`list.columns.${id}`);
                    const sortKey = CRUISE_SORT_KEY_BY_COLUMN[id];
                    return (
                      <th
                        key={id}
                        className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${
                          numeric ? "text-right" : "text-left"
                        }`}
                        style={{ color: "var(--text-muted)" }}
                      >
                        {sortKey === undefined ? (
                          label
                        ) : (
                          <span className={numeric ? "flex justify-end" : undefined}>
                            <SortableHeader
                              column={sortKey}
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onSort={handleSort}
                              ariaLabel={t("list.sortBy", { col: label })}
                            >
                              {label}
                            </SortableHeader>
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <CruiseRow
                    key={c.id}
                    index={i}
                    cruise={c}
                    isColumnVisible={columnPrefs.isVisible}
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
              </tbody>
            </table>
            </div>
            {/* Same closing line the flights and lodging tables carry: how many
                rows, and what they are sorted by. The count used to sit only in
                the filter bar, so the table simply stopped. */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
              style={{
                background: "var(--bg-elevated)",
                borderTop: "1px solid var(--color-border)",
                color: "var(--text-muted)",
              }}
            >
              <span>
                {t("list.sortedBy", {
                  col: t(`list.columns.${SORT_KEY_TO_COLUMN[sortBy] ?? sortBy}`),
                  dir: t(sortOrder === "asc" ? "list.ascending" : "list.descending"),
                })}
              </span>
            </div>
          </div>
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
    </div>
    </PageTransition>
  );
}

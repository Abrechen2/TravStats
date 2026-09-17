import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/ui/AppShell";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SkeletonTable } from "../components/SkeletonLoader";
import type { StayStatus } from "../types/lodging";
import {
  LODGING_SORT_DEFAULT_ASC,
  sortLodgingRows,
  type LodgingSortKey,
} from "../components/lodging/sortLodgingRows";
import {
  LodgingRow,
  LODGING_COLUMN_IDS as COLUMN_IDS,
  LODGING_COLUMN_LAYOUT,
  type LodgingColumnId,
} from "../components/lodging/LodgingRow";
import { Table, type TableColumn } from "../components/ui/Table";
import { lodgingLifecycleStatus } from "../components/lodging/lodgingLifecycle";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import ListFilterBar, { FilterField, PANEL_SELECT_CLASS } from "../components/table/ListFilterBar";
import { LodgingFormModal } from "../components/lodging/LodgingFormModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useLodgingImportAdapter } from "../components/import/adapters/lodgingAdapter";
import { useTranslation } from "../hooks/useTranslation";
import { countryName } from "../shared/geo/countryCode";
import { deleteLodging, listLodgings } from "../lib/api/lodging";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging, LodgingListQuery, LodgingType } from "../types/lodging";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";

type TypeFilter = LodgingType | "all";
type YearFilter = number | "all";
type CountryFilter = string | "all";
type StatusFilter = StayStatus | "all";

/** The lifecycle values a lodging row can show, in the order the pill ranks
 *  them. `null` (a house with no stays at all) is not a filterable state —
 *  the list marks those "vorgemerkt" in the name column instead. */
const STATUSES: readonly StayStatus[] = ["in_progress", "scheduled", "completed", "cancelled"];

const TYPES: LodgingType[] = ["hotel", "campsite", "guesthouse", "apartment", "hostel"];

// Column ids double as sort keys and as visibility-preference ids. The name
// column is the row's identity and can't be hidden.
/**
 * Not hideable. `name`, `lastStay` and `status` are the three the row keeps
 * when the table collapses at 390px — hiding one on a desktop would take it
 * off the phone too, because a hidden column has no cell to collapse.
 * `actions` was always here. See `components/table/narrowColumns.ts`.
 */
const ALWAYS_VISIBLE = ["name", "lastStay", "status", "actions"] as const;

/** Column id -> sort key. Identity, except that `actions` has none. */
const SORT_KEY_BY_COLUMN: Partial<Record<LodgingColumnId, LodgingSortKey>> = {
  name: "name",
  chain: "chain",
  location: "location",
  status: "status",
  lastStay: "lastStay",
  stays: "stays",
  nights: "nights",
  rating: "rating",
  spend: "spend",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One label source for header, picker, aria and footer — they must agree. */
function columnLabel(t: Translate, id: LodgingColumnId): string {
  if (id === "status") return t("lodging:list.status.label");
  if (id === "actions") return t("lodging:list.columns.actions");
  return t(`lodging:list.columns.${id}`);
}

export default function LodgingListPage(): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common", "settings", "import"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  // `totalSpendBase` is computed by the backend in the user's actual base
  // currency (`UserSettings.baseCurrency`) — NOT `units.currency`, which is an
  // independent display preference used elsewhere for flight-cost figures.
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const addToast = useToastStore((s) => s.addToast);

  // `baseline` is an UNFILTERED fetch, used only to derive the year/country
  // dropdown option sets so they don't shrink as the user narrows other
  // filters. `rows` is the server's response to the CURRENT filter query.
  // Sorting is CLIENT-side (header clicks, flights-table style): that is safe
  // here — and only here — because `listLodgings` walks every page into
  // memory before returning, so the sort always covers the complete set,
  // never one paginated slice.
  const [baseline, setBaseline] = useState<Lodging[]>([]);
  const [rows, setRows] = useState<Lodging[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [editing, setEditing] = useState<Lodging | null>(null);
  const [toDelete, setToDelete] = useState<Lodging | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Newest first everywhere, and the choice survives a reload — the
  // column choice already did (useColumnPrefs), the sort never had.
  const { sortBy, sortOrder, setSort } = useSortPrefs("lodging-list", "lastStay", "desc", [
    "lastStay",
    "name",
    "chain",
    "location",
    "status",
    "stays",
    "nights",
    "rating",
    "spend",
  ] as const);
  const columnPrefs = useColumnPrefs("lodging-list", ALWAYS_VISIBLE);

  const handleSort = (column: LodgingSortKey): void => {
    if (sortBy === column) {
      setSort(column, sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSort(column, LODGING_SORT_DEFAULT_ASC.includes(column) ? "asc" : "desc");
    }
  };

  /**
   * The visible columns, in order, with their narrow places and their sort
   * headers. One list feeds the head and every row, so a cell can no longer
   * land under the wrong column.
   */
  const visibleColumns = useMemo<TableColumn[]>(
    () =>
      COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
        const layout = LODGING_COLUMN_LAYOUT[id];
        const label = columnLabel(t, id);
        const sortKey = SORT_KEY_BY_COLUMN[id];
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
                ariaLabel={t("lodging:list.sortBy", { col: label })}
              >
                {label}
              </SortableHeader>
            ),
        };
      }),
    [columnPrefs, t, sortBy, sortOrder]
  );

  useEffect(() => {
    void listLodgings({})
      .then(setBaseline)
      .catch((err: unknown) => logger.error("LodgingListPage: baseline fetch failed", err));
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const query: LodgingListQuery = {};
      if (typeFilter !== "all") query.type = typeFilter;
      if (yearFilter !== "all") query.year = yearFilter;
      if (countryFilter !== "all") query.country = countryFilter;
      const data = await listLodgings(query);
      setRows(data);
    } catch (err: unknown) {
      logger.error("LodgingListPage: failed to load lodgings", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, yearFilter, countryFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadAll = useCallback(async (): Promise<void> => {
    await Promise.all([
      reload(),
      listLodgings({})
        .then(setBaseline)
        .catch((err: unknown) => logger.error("LodgingListPage: baseline reload failed", err)),
    ]);
  }, [reload]);

  /**
   * Deleting from the list. The dialog names the number of stays that go with
   * the house, exactly as the detail page does — the list is the place where a
   * mis-click is cheapest to make and most expensive to discover.
   */
  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteLodging(toDelete.id);
      addToast("success", t("lodging:detail.deleteSuccess"));
      setToDelete(null);
      await reloadAll();
    } catch (err: unknown) {
      logger.error("LodgingListPage: delete failed", err);
      addToast("error", t("lodging:detail.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const l of baseline) {
      for (const stay of l.stays) {
        // An undated stay belongs to no year, so it offers none to filter by.
        // It stays visible while no year is selected.
        if (stay.checkIn === null) continue;
        const year = new Date(stay.checkIn).getFullYear();
        if (!Number.isNaN(year)) years.add(year);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [baseline]);

  /**
   * One option per COUNTRY, not per spelling.
   *
   * The list used to be built from the raw `country` text, which is whatever
   * the source wrote — so "Deutschland" and "Germany" stood side by side as two
   * places, and a real library showed 60 entries for 33 countries. Grouping on
   * the derived ISO code collapses them; a house whose text names no country
   * (a city in the country field, say) keeps its own entry rather than
   * disappearing from the filter entirely.
   */
  const availableCountries = useMemo(() => {
    const byValue = new Map<string, string>();
    for (const l of baseline) {
      if (l.isoCountryCode) {
        byValue.set(
          l.isoCountryCode,
          countryName(l.isoCountryCode, i18n.language) || l.isoCountryCode
        );
      } else if (l.country) {
        byValue.set(l.country, l.country);
      }
    }
    return Array.from(byValue, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [baseline, i18n.language]);

  // Free-text search narrows visibility; the header sort then orders the
  // survivors. Both run over the COMPLETE set (`listLodgings` returns every
  // row), so this cannot reintroduce the sorted-then-truncated-then-resorted
  // bug the old server-side-only sorting guarded against.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = rows.filter((l) => {
      // Status is DERIVED from the stays (see lodgingLifecycle), so unlike
      // type/year/country it cannot be a query parameter — it is decided here,
      // over the complete set the server already returned.
      if (statusFilter !== "all" && lodgingLifecycleStatus(l.stays) !== statusFilter) return false;
      if (needle.length > 0) {
        const haystack = `${l.name} ${l.chain?.name ?? ""} ${l.city ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    return sortLodgingRows(visible, sortBy, sortOrder);
  }, [rows, search, statusFilter, sortBy, sortOrder]);

  const summaryFigures = useMemo(() => {
    let stays = 0;
    let nights = 0;
    const chains = new Set<string>();
    for (const l of filtered) {
      stays += l.stayCount;
      nights += l.nights;
      if (l.chain?.name) chains.add(l.chain.name);
    }
    return [
      { key: "lodgings", value: String(filtered.length), label: t("common:summary.lodgings") },
      { key: "stays", value: String(stays), label: t("common:summary.stays") },
      { key: "nights", value: String(nights), label: t("common:summary.nights") },
      { key: "chains", value: String(chains.size), label: t("common:summary.chains") },
    ];
  }, [filtered, t]);

  const resetFilters = (): void => {
    setSearch("");
    setTypeFilter("all");
    setYearFilter("all");
    setCountryFilter("all");
    setStatusFilter("all");
  };

  // Type and country are the two only lodging has; they sit behind the button.
  const extraActiveCount = (typeFilter === "all" ? 0 : 1) + (countryFilter === "all" ? 0 : 1);
  const hasActiveFilter =
    search.length > 0 || statusFilter !== "all" || yearFilter !== "all" || extraActiveCount > 0;

  const importAdapter = useLodgingImportAdapter();

  return (
    <AppShell width="table">
      <LogbookTabs />
      {/* The width is the shell's now — `table`, asked for by name. */}
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("lodging:list.title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={COLUMN_IDS.map((id) => ({
                id,
                label:
                  id === "status"
                    ? t("lodging:list.status.label")
                    : t(`lodging:list.columns.${id}`),
                always: (ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            {/* One way in, not three. "Buchung einlesen" used to sit here as
                its own button beside "Importieren" and "Hotel hinzufügen" —
                three controls for two ideas, and two of them saying "import".
                Reading a booking is not a separate act, it is the first and
                best ROUTE into adding one, so it lives inside this dialog now.
                The bulk hub keeps a quiet link below, not a rival button. */}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("lodging:add.title")}</span>
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs text-(--text-muted)">
          {t("lodging:list.wholeListHint")}{" "}
          <Link
            to="/settings/data?section=import"
            className="underline underline-offset-4 hover:text-(--text-primary)"
          >
            {t("settings:import.openHub")}
          </Link>
        </p>

        {/* Was `LodgingStatStrip`, which renders the backend rollup over the
            WHOLE library — correct on the dashboard, contradictory here: it
            showed the spend of 60 hotels above a table filtered down to seven,
            next to a filter-aware "7 angezeigt" in the bar. The strip keeps its
            home on the dashboard tab; this list summarises the rows it shows. */}
        <ListSummaryStrip
          figures={summaryFigures}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadError}
        />

        <ListFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("lodging:filter.searchPlaceholder"),
          }}
          status={{
            label: t("lodging:list.status.label"),
            value: statusFilter,
            onChange: (v): void => setStatusFilter(v as StatusFilter),
            allLabel: t("lodging:filter.allStatuses"),
            options: STATUSES.map((st) => ({
              value: st,
              label: t(`lodging:stayStatus.${st}`),
            })),
          }}
          year={{
            label: t("lodging:filter.year"),
            value: yearFilter === "all" ? "all" : String(yearFilter),
            onChange: (v): void => setYearFilter(v === "all" ? "all" : Number.parseInt(v, 10)),
            allLabel: t("lodging:filter.allYears"),
            options: availableYears.map((y) => ({ value: String(y), label: String(y) })),
          }}
          extraActiveCount={extraActiveCount}
          extra={
            <>
              <FilterField label={t("lodging:filter.type")}>
                <select
                  value={typeFilter}
                  onChange={(e): void => setTypeFilter(e.target.value as TypeFilter)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("lodging:filter.allTypes")}</option>
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`lodging:type.${ty}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={t("lodging:filter.country")}>
                <select
                  value={countryFilter}
                  onChange={(e): void => setCountryFilter(e.target.value)}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="all">{t("lodging:filter.allCountries")}</option>
                  {availableCountries.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </FilterField>
            </>
          }
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={
            loading || loadError ? "" : t("common:filters.showing", { count: filtered.length })
          }
        />

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("lodging:list.loadError")}
          </div>
        ) : (
          <>
            {loading ? (
              <SkeletonTable rows={10} />
            ) : filtered.length === 0 ? (
              <div
                className="overflow-hidden rounded-lg"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <ListEmptyState
                  filtered={hasActiveFilter}
                  emptyTitle={t("lodging:list.empty")}
                  emptyHint={t("lodging:list.emptyHint")}
                  onReset={resetFilters}
                />
              </div>
            ) : (
              <>
                <Table columns={visibleColumns} label={t("lodging:list.title")} {...tableHints}>
                  {filtered.map((l) => (
                    <LodgingRow
                      key={l.id}
                      lodging={l}
                      baseCurrency={baseCurrency}
                      columns={visibleColumns}
                      onOpen={() => navigate(`/lodging/${l.id}`)}
                      onEdit={() => setEditing(l)}
                      onDelete={() => setToDelete(l)}
                    />
                  ))}
                </Table>
                <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
                  {t("lodging:list.footer.sortedBy", {
                    label: columnLabel(t, sortBy),
                    direction:
                      sortOrder === "asc"
                        ? t("common:sort.ascending")
                        : t("common:sort.descending"),
                  })}
                </p>
              </>
            )}
          </>
        )}

        {/* The CSV tile used to sit here. It now lives in the central import
            hub (Settings → Import), which is where every domain's LIST
            importers belong — the line under the heading links there. Reading
            a single booking is the first route in the add-dialog below. */}

        {/* The import log used to sit here. It moved to the central import
            hub (Settings → Import) together with the importers it belongs to —
            one place to import, one place to see and undo what was imported. */}

        {/* Adding asks "what do you have?" first: a booking mail or PDF fills
            everything in, typing it out is the last resort in the footer. The
            form itself is unchanged — it is now one route among several. */}
        <DomainImportPanel
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onItemsCreated={reloadAll}
          adapter={importAdapter}
        />

        {editing && (
          <LodgingFormModal
            mode="edit"
            lodging={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reloadAll();
            }}
          />
        )}

        <ConfirmModal
          isOpen={toDelete !== null}
          onClose={() => setToDelete(null)}
          onConfirm={() => void confirmDelete()}
          isLoading={deleting}
          title={t("lodging:detail.deleteConfirmTitle")}
          // Through the shared helper, like the DETAIL page — this call site
          // was left behind when the six sentences were unified, so the list
          // rendered a literal "{{name}}" and said "mit 0 Aufenthalten" for a
          // house that has none. Exactly the drift the helper exists to stop.
          message={
            toDelete
              ? countedDeleteMessage(
                  t,
                  {
                    counted: "lodging:detail.deleteConfirmMessage",
                    empty: "lodging:detail.deleteConfirmMessageNoStays",
                  },
                  toDelete.name,
                  toDelete.stayCount
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

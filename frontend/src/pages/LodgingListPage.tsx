import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/ui/AppShell";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SkeletonTable } from "../components/SkeletonLoader";
import type { StayStatus } from "../types/lodging";
import {
  buildLodgingFilterQuery,
  buildLodgingListQuery,
  lodgingFilterSignature,
  LODGING_SORT_DEFAULT_ASC,
  type LodgingListFilterState,
} from "../lib/lodging/lodgingListQuery";
import {
  LodgingRow,
  LODGING_COLUMN_IDS as COLUMN_IDS,
  LODGING_COLUMN_LAYOUT,
  type LodgingColumnId,
} from "../components/lodging/LodgingRow";
import { Table, type TableColumn } from "../components/ui/Table";
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
import { deleteLodging, getLodgingFacets, listLodgingPage } from "../lib/api/lodging";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging, LodgingFacets, LodgingSortKey, LodgingType } from "../types/lodging";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { useServerPagination } from "../components/table/useServerPagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import TablePagination from "../components/table/TablePagination";
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

  // `rows` is ONE page, in the order the server decided; `total` is the size
  // of the filtered set it came from. Both the sort and the filters are query
  // parameters now (2026-09-20). They were not, and could not be while the
  // sort keys were derived from the stays: the page walked the whole library
  // in a `limit=500` loop, and then walked it a SECOND time, unfiltered, only
  // to fill the year and country dropdowns. `/lodging/facets` fills those.
  const [rows, setRows] = useState<Lodging[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [facets, setFacets] = useState<LodgingFacets | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [editing, setEditing] = useState<Lodging | null>(null);
  const [toDelete, setToDelete] = useState<Lodging | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const debouncedSearch = useDebouncedValue(search);
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

  /**
   * The filter bar's answers as ONE value, so the query, the effect
   * dependencies and the pager's reset key cannot drift apart.
   */
  const filterState = useMemo<LodgingListFilterState>(
    () => ({
      // Debounced: the search used to narrow rows the browser already held, so
      // typing cost nothing. As a query parameter, "Steigenberger" would be
      // thirteen requests without this.
      search: debouncedSearch,
      status: statusFilter,
      year: yearFilter,
      country: countryFilter,
      type: typeFilter,
    }),
    [debouncedSearch, statusFilter, yearFilter, countryFilter, typeFilter]
  );
  const filterSignature = useMemo(() => lodgingFilterSignature(filterState), [filterState]);

  const pagination = useServerPagination(total, "lodging-list", filterSignature);
  const { limit, offset } = pagination;

  // Bumped by anything that CHANGES rows (a delete, an import, an edit), which
  // no filter or page dependency would otherwise notice.
  const [reloadToken, setReloadToken] = useState<number>(0);
  const reloadAll = useCallback(async (): Promise<void> => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setLoadError(false);
      try {
        const page = await listLodgingPage(
          buildLodgingListQuery(filterState, { sortBy, sortOrder }, { limit, offset })
        );
        if (cancelled) return;
        setRows(page.rows);
        setTotal(page.total);
      } catch (err: unknown) {
        if (cancelled) return;
        logger.error("LodgingListPage: failed to load lodgings", err);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterState, sortBy, sortOrder, limit, offset, reloadToken]);

  // The option lists and the summary figures. Separate from the page fetch on
  // purpose: turning a page or re-sorting changes none of these numbers, and
  // asking again would make every page turn cost a second count over the whole
  // filtered set.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const data = await getLodgingFacets(buildLodgingFilterQuery(filterState));
        if (!cancelled) setFacets(data);
      } catch (err: unknown) {
        // The table still works without them; the strip and the dropdowns go
        // quiet rather than showing counts nobody measured.
        logger.error("LodgingListPage: failed to load lodging facets", err);
        if (!cancelled) setFacets(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filterState, reloadToken]);

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

  /**
   * Counted by the database under every OTHER filter, so picking a country no
   * longer leaves the year list holding only that country's years — and, more
   * to the point, so neither list needs a second read of the whole library.
   * An undated stay belongs to no year and so offers none; the house stays
   * visible while no year is selected.
   */
  const availableYears = useMemo(() => (facets?.years ?? []).map((y) => y.year), [facets]);

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
  const availableCountries = useMemo(
    () =>
      (facets?.countries ?? [])
        .map((c) => ({
          value: c.value,
          // The server groups on the derived ISO code, so "Deutschland" and
          // "Germany" are one option; the NAME is still resolved here, because
          // it is the reader's language that decides it. A house whose text
          // names no country ("Dubai" is a city) keeps its own entry under
          // that text rather than disappearing from the filter.
          label: c.isoCode ? countryName(c.isoCode, i18n.language) || c.isoCode : c.value,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [facets, i18n.language]
  );

  /**
   * The figures above the table, counted by the database over the WHOLE
   * filtered set — not over the page, and not by this browser.
   *
   * They were summed here from `filtered`, which worked only because the page
   * held every row. Summing a page would have said "25 Unterkünfte" over a
   * library of three hundred. The counting rule behind `stays` and `nights` is
   * the same one the rows use — `shared/lodgingCounting.ts`, restated for SQL
   * in `services/lodging/listSql.ts` and pinned against it by a test — so the
   * strip and the column beneath it cannot disagree.
   */
  const summaryFigures = useMemo(
    () =>
      facets === null
        ? []
        : [
            {
              key: "lodgings",
              value: String(facets.summary.lodgings),
              label: t("common:summary.lodgings"),
            },
            {
              key: "stays",
              value: String(facets.summary.stays),
              label: t("common:summary.stays"),
            },
            {
              key: "nights",
              value: String(facets.summary.nights),
              label: t("common:summary.nights"),
            },
            {
              key: "chains",
              value: String(facets.summary.chains),
              label: t("common:summary.chains"),
            },
          ],
    [facets, t]
  );

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
          resultLabel={loading || loadError ? "" : t("common:filters.matching", { count: total })}
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
            ) : rows.length === 0 ? (
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
                  {rows.map((l: Lodging) => (
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
                {/* `allowAll` is off, as on the flights logbook: over a
                    network "Alle" would promise a row count nobody checked,
                    and the API caps a page at 500 — so it would quietly mean
                    "the first 500 of however many". `meta.total` is shown in
                    the range text instead, which is the honest version of the
                    same reassurance. */}
                <TablePagination {...pagination} allowAll={false} />
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

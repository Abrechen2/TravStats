import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";
import { StarRating } from "../components/lodging/StarRating";
import { ChainNameLink } from "../components/lodging/ChainNameLink";
import { LodgingStatusTag } from "../components/lodging/LodgingStatusTag";
import { StayStatusPill } from "../components/lodging/StayStatusPill";
import { lodgingLifecycleStatus } from "../components/lodging/lodgingLifecycle";
import type { StayStatus } from "../types/lodging";
import {
  LODGING_SORT_DEFAULT_ASC,
  sortLodgingRows,
  type LodgingSortKey,
} from "../components/lodging/sortLodgingRows";
import { formatDateInTimezone } from "../lib/dateUtils";
import { latestStayDayOf } from "../lib/lodgingLatestStay";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListEmptyState from "../components/table/ListEmptyState";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import ListFilterBar, {
  FilterField,
  PANEL_SELECT_CLASS,
} from "../components/table/ListFilterBar";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { LodgingFormModal } from "../components/lodging/LodgingFormModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useLodgingImportAdapter } from "../components/import/adapters/lodgingAdapter";
import { useTranslation } from "../hooks/useTranslation";
import { countryName } from "../shared/geo/countryCode";
import { deleteLodging, listLodgings } from "../lib/api/lodging";
import { formatCurrency } from "../lib/units";
import {
  countUnconvertedStays,
  hasAnyPrice,
  lodgingTypeIcon,
  singleCurrencySpend,
  singleOriginalCurrencySpend,
} from "../lib/lodgingFormat";
import { FlagImg, resolveCountryCode } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging, LodgingListQuery, LodgingType } from "../types/lodging";
import { useSortPrefs } from "../components/table/useSortPrefs";

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
/** Every column, sortable or not. `actions` carries no value to sort by. */
type LodgingColumnId = LodgingSortKey | "actions";

const COLUMN_IDS: readonly LodgingColumnId[] = [
  "name",
  "chain",
  "location",
  "status",
  "lastStay",
  "stays",
  "nights",
  "rating",
  "spend",
  "actions",
];
const ALWAYS_VISIBLE = ["name", "actions"] as const;
const NUMERIC_COLUMNS: readonly LodgingColumnId[] = ["stays", "nights", "spend"];

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
  const { sortBy, sortOrder, setSort } = useSortPrefs("lodging-list", "lastStay", "desc", ["lastStay","name","chain","location","status","stays","nights","rating","spend"] as const);
  const columnPrefs = useColumnPrefs("lodging-list", ALWAYS_VISIBLE);

  const handleSort = (column: LodgingSortKey): void => {
    if (sortBy === column) {
      setSort(column, sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSort(column, LODGING_SORT_DEFAULT_ASC.includes(column) ? "asc" : "desc");
    }
  };

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
        byValue.set(l.isoCountryCode, countryName(l.isoCountryCode, i18n.language) || l.isoCountryCode);
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
    search.length > 0 ||
    statusFilter !== "all" ||
    yearFilter !== "all" ||
    extraActiveCount > 0;

  const importAdapter = useLodgingImportAdapter();

  return (
    <PageTransition>
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />

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

      {/* Same width budget as the flights table page (max-w 2xl breakpoint) —
          the old max-w-6xl squeezed the table into two thirds of the screen. */}
      <div className="mx-auto max-w-(--breakpoint-2xl) px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {t("lodging:list.title")}
          </h1>
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
            to="/settings?section=import"
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

        {loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("lodging:list.loadError")}
          </div>
        ) : (
          // Flights-table shell: rounded, clipped, zebra rows, sticky-toned
          // header, footer bar — one family across the domain list pages.
          <div
            className="overflow-hidden rounded-lg shadow-xs"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <div className="overflow-x-auto">
              {loading ? (
                <SkeletonTable rows={10} />
              ) : filtered.length === 0 ? (
                <ListEmptyState
                  filtered={hasActiveFilter}
                  emptyTitle={t("lodging:list.empty")}
                  emptyHint={t("lodging:list.emptyHint")}
                  onReset={resetFilters}
                />
              ) : (
                <table className="w-full min-w-[960px] text-sm">
                  <thead
                    style={{
                      background: "var(--bg-elevated)",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <tr>
                      {COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
                        const right = NUMERIC_COLUMNS.includes(id) || id === "actions";
                        const sortKey = SORT_KEY_BY_COLUMN[id];
                        const label = columnLabel(t, id);
                        return (
                          <th
                            key={id}
                            className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${
                              right ? "text-right whitespace-nowrap" : "text-left"
                            }`}
                            style={{ color: "var(--text-muted)" }}
                          >
                            {sortKey === undefined ? (
                              label
                            ) : (
                              <span className={right ? "flex justify-end" : undefined}>
                                <SortableHeader
                                  column={sortKey}
                                  sortBy={sortBy}
                                  sortOrder={sortOrder}
                                  onSort={handleSort}
                                  ariaLabel={t("lodging:list.sortBy", { col: label })}
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
                    {filtered.map((l, index) => (
                      <tr
                        key={l.id}
                        onClick={() => navigate(`/lodging/${l.id}`)}
                        className="cursor-pointer"
                        style={{
                          background:
                            index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                          borderTop: "1px solid var(--color-border)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--bg-muted)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)";
                        }}
                      >
                        {columnPrefs.isVisible("name") && (
                          <td className="px-4 py-3">
                            <span aria-hidden className="mr-2">
                              {lodgingTypeIcon(l.type)}
                            </span>
                            <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
                            {/* A saved-places import can bring in hundreds of houses
                                the user has never slept in. Without a mark they are
                                indistinguishable from the maintained ones. */}
                            {!l.visited && (
                              <span
                                data-testid={`lodging-bookmarked-${l.id}`}
                                title={t("lodging:list.bookmarkedHint")}
                                className="ml-2 rounded border border-[var(--color-border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
                              >
                                {t("lodging:list.bookmarked")}
                              </span>
                            )}
                          </td>
                        )}
                        {columnPrefs.isVisible("chain") && (
                          <td className="px-4 py-3 text-[var(--text-muted)]">
                            {l.chain ? (
                              <ChainNameLink chainId={l.chain.id} name={l.chain.name} />
                            ) : (
                              t("lodging:field.independent")
                            )}
                          </td>
                        )}
                        {columnPrefs.isVisible("location") && (
                          <td className="px-4 py-3 text-[var(--text-muted)]">
                            {l.city || l.country ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span>{l.city || l.country}</span>
                                <FlagImg country={resolveCountryCode(l.country)} height={12} />
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        {columnPrefs.isVisible("status") && (
                          <td className="px-4 py-3">
                            {/* Lifecycle first (like the flights status pill:
                                running / booked / past / cancelled), the
                                data-quality tag beside it. */}
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              {(() => {
                                const lifecycle = lodgingLifecycleStatus(l.stays);
                                return lifecycle ? (
                                  <StayStatusPill
                                    status={lifecycle}
                                    testId={`lodging-lifecycle-${l.id}`}
                                  />
                                ) : null;
                              })()}
                              <LodgingStatusTag lodging={l} />
                            </span>
                          </td>
                        )}
                        {columnPrefs.isVisible("lastStay") && (
                          <td className="px-4 py-3 whitespace-nowrap">
                            {(() => {
                              // The hotel's own date: newest stay, planned ones
                              // included — same helper the activity sidebar uses,
                              // so the two cannot drift apart.
                              const day = latestStayDayOf(l);
                              return day ? formatDateInTimezone(day, "UTC") : "—";
                            })()}
                          </td>
                        )}
                        {columnPrefs.isVisible("stays") && (
                          <td className="px-4 py-3 text-right">{l.stayCount}</td>
                        )}
                        {columnPrefs.isVisible("nights") && (
                          <td className="px-4 py-3 text-right">{l.nights}</td>
                        )}
                        {columnPrefs.isVisible("rating") && (
                          <td className="px-4 py-3">
                            <StarRating value={l.overallRating} />
                          </td>
                        )}
                        {columnPrefs.isVisible("spend") && (
                          <td className="px-4 py-3 text-right">
                            <LodgingSpendCell lodging={l} baseCurrency={baseCurrency} />
                            {hasOtherBaseCurrencySpend(l.totalSpendBaseByCurrency, baseCurrency) && (
                              <span
                                className="ml-1 align-super text-[10px] text-[var(--text-muted)]"
                                title={t("lodging:list.otherCurrencyHint")}
                              >
                                *
                              </span>
                            )}
                          </td>
                        )}
                        {columnPrefs.isVisible("actions") && (
                          <td className="px-4 py-3">
                            <RowActions>
                              <RowActionButton
                                icon="edit"
                                label={t("common:buttons.edit")}
                                testId={`lodging-edit-${l.id}`}
                                onClick={() => setEditing(l)}
                              />
                              <RowActionButton
                                icon="delete"
                                label={t("common:buttons.delete")}
                                testId={`lodging-delete-${l.id}`}
                                onClick={() => setToDelete(l)}
                              />
                            </RowActions>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {!loading && filtered.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-[var(--text-muted)]"
                style={{
                  background: "var(--bg-elevated)",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <span>
                  {t("lodging:list.footer.sortedBy", {
                    label: columnLabel(t, sortBy),
                    direction:
                      sortOrder === "asc"
                        ? t("common:sort.ascending")
                        : t("common:sort.descending"),
                  })}
                </span>
              </div>
            )}
          </div>
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
    </div>
    </PageTransition>
  );
}

/**
 * True when this lodging has spend snapshotted under a base currency OTHER
 * than the user's current one — i.e. `totalSpendBase` (which only counts the
 * current-base slice) is not the whole picture. Used to render a small,
 * honest "*" hint rather than silently folding those older amounts in
 * (finding 2).
 */
function hasOtherBaseCurrencySpend(
  byCurrency: Record<string, number>,
  currentBaseCurrency: string
): boolean {
  return Object.keys(byCurrency).some((currency) => currency !== currentBaseCurrency);
}

/**
 * Spend column body for one list row (mockup screen ①): the original
 * currency amount with the converted total underneath when every priced
 * stay shares one non-base currency (e.g. "840 CHF" / "≈ 883 €"), the plain
 * converted total when spend is already base-currency or mixed, and "—"
 * (never "0 €") when nothing on this lodging has a recorded price at all.
 */
function LodgingSpendCell({
  lodging,
  baseCurrency,
}: {
  lodging: Lodging;
  baseCurrency: string;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  if (!hasAnyPrice(lodging.stays)) return <>—</>;

  const original = singleOriginalCurrencySpend(lodging.stays, baseCurrency);
  // Priced, but nothing converted: `totalSpendBase` is 0 because the sum has
  // no addends, NOT because the stay cost nothing. Rendering that zero told
  // the reader a hotel was free — and where an original amount was shown it
  // read "$780 ≈ 0 €", which is worse, because it looks like arithmetic.
  //
  // Asked as "is every priced stay unconverted", never as `totalSpendBase === 0`:
  // a genuinely free night (an award stay entered as 0) converts fine and its
  // total is honestly zero.
  const pricedCount = lodging.stays.filter((s) => s.totalPrice !== null).length;
  const unconverted = countUnconvertedStays(lodging.stays);
  const nothingConverted = unconverted === pricedCount;
  // Some converted, some not: the figure below is real but incomplete, and
  // saying so is the same rule the detail page and the stat strip follow.
  const omitted =
    !nothingConverted && unconverted > 0 ? (
      <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
        {t("lodging:fx.omittedFromTotal", { count: unconverted })}
      </div>
    ) : null;
  if (nothingConverted) {
    // `singleCurrencySpend`, not `original`: with no conversion shown next to
    // it there is nothing for a base-currency amount to be redundant WITH, and
    // hiding it left the row saying "kein Kurs" with no number at all.
    const amount = singleCurrencySpend(lodging.stays);
    return (
      <>
        {amount && <div>{formatCurrency(amount.amount, amount.currency)}</div>}
        <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
          {t("lodging:fx.markerNone")}
        </div>
      </>
    );
  }
  if (!original) {
    return (
      <>
        <div>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</div>
        {omitted}
      </>
    );
  }

  return (
    <>
      <div>{formatCurrency(original.amount, original.currency)}</div>
      <div className="text-[10px]" style={{ color: "var(--fx, #6ab7d8)" }}>
        ≈ {formatCurrency(lodging.totalSpendBase, baseCurrency)}
      </div>
      {omitted}
    </>
  );
}

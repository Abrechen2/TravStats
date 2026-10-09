import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/ui/AppShell";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SkeletonTable } from "../components/SkeletonLoader";
import { ColumnPicker } from "../components/table/ColumnPicker";
import {
  PlaceRow,
  PLACE_COLUMN_IDS as COLUMN_IDS,
  PLACE_COLUMN_LAYOUT,
  type PlaceColumnId,
  type PlaceSortKey,
} from "../components/places/PlaceRow";
import { Table, type TableColumn } from "../components/ui/Table";
import { SortableHeader } from "../components/table/SortableHeader";
import ListFilterBar, { FilterField, PANEL_SELECT_CLASS } from "../components/table/ListFilterBar";
import ListEmptyState from "../components/table/ListEmptyState";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import { STATUS_PILL_CLASS, statusPillStyle } from "../components/table/statusPillStyle";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import ConfirmModal from "../components/Training/ConfirmModal";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { placeDeleteMessage } from "../lib/placeDeleteMessage";
import { usePlaceRelations } from "../hooks/usePlaceRelations";
import { PlaceFormModal } from "../components/places/PlaceFormModal";
import { VisitDialog } from "../components/places/VisitDialog";
import { FormErrorBanner, navigateAfterSave } from "../components/form";
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { continentLabel } from "../lib/continentLabel";
import { placeCountryCode, placeCountryLabel } from "../lib/placeCountry";
import { listPlaceLists } from "../lib/api/placeLists";
import type { PlaceList } from "../types/placeList";
import { logger } from "../lib/logger";
import { deletePlace, listPlaces } from "../lib/api/places";
import { useToastStore } from "../store/toastStore";
import { PLACE_CATEGORIES, PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import { classifyPlace } from "../shared/placeCounting";
import type { PlaceCategory } from "../shared/placeCategories";
import type { Place } from "../types/place";
import { useSortPrefs } from "../components/table/useSortPrefs";
import { usePagination } from "../components/table/usePagination";
import TablePagination from "../components/table/TablePagination";
import { formatIsoDate } from "../lib/dateUtils";
import { useTableHints } from "../components/ui/useTableHints";
import LogbookTabs from "../components/table/LogbookTabs";
import { LocalName } from "../components/places/LocalName";

type CategoryFilter = PlaceCategory | "all";
type CountryFilter = string | "all";
/** Tri-state on the wire; "all" means the list shows wishlist entries too, so
 *  the one view meant to contain them never hides them. */
/** Three states, like every other domain: been there, going there, want to
 *  go. `planned` is derived from a dated future visit, never stored. */
/** Place state -> the shared status vocabulary. "excluded" is a wishlist
 *  entry, which has no equivalent elsewhere and falls through to the neutral
 *  style — deliberately: wanting to go somewhere is not a problem. */
const PLACE_PILL_STATUS = {
  visited: "completed",
  planned: "scheduled",
  excluded: "wishlist",
} as const;

const PLACE_STATUS_KEY = {
  visited: "visited",
  planned: "planned",
  excluded: "wishlist",
} as const;

type VisitedFilter = "all" | "visited" | "planned" | "wishlist";

/**
 * Not hideable. `name`, `lastVisit` and `status` are the three the row keeps
 * when the table collapses at 390px — hiding one on a desktop would take it
 * off the phone too, because a hidden column has no cell to collapse.
 * `actions` was always here. See `components/table/narrowColumns.ts`.
 */
const ALWAYS_VISIBLE = ["name", "lastVisit", "status", "actions"] as const;

const SORT_KEY_BY_COLUMN: Partial<Record<PlaceColumnId, PlaceSortKey>> = {
  name: "name",
  category: "category",
  location: "location",
  country: "country",
  continent: "continent",
  visits: "visits",
  lastVisit: "lastVisit",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The country as a reader sees it — localised from the ISO code, falling back
 *  to whatever text the source wrote. */

/** One label source for header, picker, aria and footer — they must agree. */
function columnLabel(t: Translate, id: PlaceColumnId): string {
  return t(`places:list.columns.${id}`);
}

/** Sort keys that read most naturally descending first — the same convention
 *  the lodging list uses for its count columns. */
const SORT_DEFAULT_ASC: Record<PlaceSortKey, boolean> = {
  name: true,
  category: true,
  location: true,
  country: true,
  continent: true,
  visits: false,
  lastVisit: false,
};

function compareRows(a: Place, b: Place, key: PlaceSortKey, locale: string, t: Translate): number {
  switch (key) {
    case "category":
      return a.category.localeCompare(b.category);
    case "location":
      return (a.city ?? "").localeCompare(b.city ?? "", locale);
    // Country and continent sort on the LOCALISED label, not the raw code: a
    // German reader expects Ägypten by Ä, and "EG" would file it under E.
    case "country":
      return placeCountryLabel(a, locale).localeCompare(placeCountryLabel(b, locale), locale);
    case "continent":
      return continentLabel(a.continent, t, "").localeCompare(
        continentLabel(b.continent, t, ""),
        locale
      );
    case "visits":
      return a.visitCount - b.visitCount;
    case "lastVisit": {
      // Undated-but-visited places sort to the END either way rather than
      // pretending to be the oldest — a missing date is not a date.
      const av = a.lastVisitAt ? Date.parse(a.lastVisitAt) : Number.NEGATIVE_INFINITY;
      const bv = b.lastVisitAt ? Date.parse(b.lastVisitAt) : Number.NEGATIVE_INFINITY;
      return av - bv;
    }
    default:
      return a.name.localeCompare(b.name, locale);
  }
}

export default function PlacesListPage(): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const tableHints = useTableHints();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const access = usePlacesAccess();

  const [rows, setRows] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Place | null>(null);
  const [creating, setCreating] = useState(false);
  /** The place a visit is being recorded for, from its row (forgejo#231). */
  const [recordingFor, setRecordingFor] = useState<Place | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<{ key: string; place: Place } | null>(null);
  // Counted only while the question is open; the dialog opens at once and
  // names photos, documents, lists and trips as soon as they are known.
  const deleteRelations = usePlaceRelations(pendingDelete?.id ?? null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [country, setCountry] = useState<CountryFilter>("all");
  /** Which list a place must belong to. "all" = every place. A filter, not
   *  a mode: it changes WHICH rows are shown, never what one means. */
  const [listId, setListId] = useState<string>("all");
  const [lists, setLists] = useState<PlaceList[]>([]);
  const [visited, setVisited] = useState<VisitedFilter>("all");
  // Newest first everywhere, and the choice survives a reload — the
  // column choice already did (useColumnPrefs), the sort never had.
  const { sortBy, sortOrder, setSort } = useSortPrefs("places-list", "lastVisit", "desc", [
    "name",
    "category",
    "location",
    "country",
    "continent",
    "visits",
    "lastVisit",
  ] as const);

  const columnPrefs = useColumnPrefs("places", ALWAYS_VISIBLE);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      // `listPlaces` walks every page into memory, so client-side sorting and
      // filtering below always cover the COMPLETE set rather than one
      // paginated slice — the same reason the lodging list sorts client-side.
      setRows(await listPlaces({}));
    } catch (err: unknown) {
      logger.error({ err }, "PlacesListPage: failed to load places");
      setLoadError(true);
      setLoadFailure(loadFailureLog(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Entries come with the lists, because the filter needs membership, not just
  // names. A failure here leaves the dropdown out rather than breaking the
  // page: a missing filter is an inconvenience, a blank list page is not.
  useEffect(() => {
    let cancelled = false;
    listPlaceLists(true)
      .then((rows) => {
        if (!cancelled) setLists(rows);
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const listMembers = useMemo(() => {
    if (listId === "all") return null;
    const found = lists.find((l) => l.id === listId);
    return new Set((found?.entries ?? []).map((e) => e.placeId));
  }, [lists, listId]);

  const countryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of rows) {
      if (!p.isoCountryCode) continue;
      // Label from the code, not from the row's own spelling — otherwise the
      // dropdown reads "مصر" for a German reader whenever that row sorted first.
      seen.set(p.isoCountryCode, placeCountryLabel(p, i18n.language) || p.isoCountryCode);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], i18n.language));
  }, [rows, i18n.language]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (country !== "all" && p.isoCountryCode !== country) return false;
      if (listMembers && !listMembers.has(p.id)) return false;
      if (visited !== "all") {
        const state = classifyPlace(p);
        const wanted =
          visited === "visited" ? "visited" : visited === "planned" ? "planned" : "excluded";
        if (state !== wanted) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.localName ?? "").toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q) ||
        (p.address ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...out].sort((a, b) => compareRows(a, b, sortBy, i18n.language, t) * dir);
  }, [rows, search, category, country, visited, listMembers, sortBy, sortOrder, i18n.language]);
  // Pages over the already filtered+sorted set — the summary strip and the
  // filter option lists above keep reading `filtered`/`rows`, never this.
  const pagination = usePagination(filtered, "places-list");

  const handleSort = useCallback(
    (key: PlaceSortKey): void => {
      if (sortBy === key) {
        setSort(key, sortOrder === "asc" ? "desc" : "asc");
      } else {
        setSort(key, SORT_DEFAULT_ASC[key] ? "asc" : "desc");
      }
    },
    [sortBy, sortOrder, setSort]
  );

  /**
   * The visible columns, in order, with their narrow places and their sort
   * headers. One list feeds the head and every row, so a cell can no longer
   * land under the wrong column.
   */
  const visibleColumns = useMemo<TableColumn[]>(
    () =>
      COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
        const layout = PLACE_COLUMN_LAYOUT[id];
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
                ariaLabel={t("places:list.sortBy", { col: label })}
              >
                {label}
              </SortableHeader>
            ),
        };
      }),
    [columnPrefs, t, sortBy, sortOrder, handleSort]
  );

  const hasActiveFilter =
    search.trim() !== "" ||
    category !== "all" ||
    country !== "all" ||
    listId !== "all" ||
    visited !== "all";

  /** Read straight off the visible rows, like the other three lists. Visits
   *  are counted from data and dates (shared/placeCounting), never from a
   *  status string — a visit dated in the future is not one. */
  const summaryFigures = useMemo(() => {
    const countries = new Set<string>();
    let visited = 0;
    for (const p of filtered) {
      // Count by ISO, never by the stored text. Reverse geocoding writes the
      // country in ITS OWN language — "Egypt" from one row and "مصر" from the
      // next are the same country, and counting the strings made it two.
      const cc = placeCountryCode(p);
      if (cc) countries.add(cc);
      if (p.visited) visited += 1;
    }
    return [
      {
        key: "places",
        value: String(filtered.length),
        label: t("common:summary.places", { count: filtered.length }),
      },
      { key: "visited", value: String(visited), label: t("common:summary.visited") },
      {
        key: "countries",
        value: String(countries.size),
        label: t("common:summary.countries", { count: countries.size }),
      },
    ];
  }, [filtered, t]);

  const resetFilters = useCallback((): void => {
    setSearch("");
    setCategory("all");
    setCountry("all");
    setListId("all");
    setVisited("all");
  }, []);

  /**
   * Delete, once. A refusal closes the question and stays on the page, naming
   * the place and why (forgejo#246) — it was a toast — with a retry when
   * asking again can help. The reload after a delete has its own failure
   * state (`ListLoadFailed`), so a stored delete never reads as a refused one.
   */
  const runDelete = useCallback(
    async (target: Place): Promise<void> => {
      setDeleting(true);
      setDeleteFailure(null);
      try {
        await deletePlace(target.id);
      } catch (err: unknown) {
        logger.error({ err }, "PlacesListPage: delete failed");
        setDeleteFailure({ key: saveErrorKey(err, "places:list.deleteFailed"), place: target });
        setPendingDelete(null);
        setDeleting(false);
        return;
      }
      setDeleting(false);
      setPendingDelete(null);
      addToast("success", t("places:list.deleted", { name: target.name }));
      await load();
    },
    [addToast, t, load]
  );

  const formatDate = useCallback(
    // ISO in the table (E7). A visit is a calendar date, stored as UTC midnight.
    (iso: string | null): string => (iso ? formatIsoDate(iso) : "—"),
    []
  );

  if (access === "denied") {
    return (
      <AppShell width="reading">
        <div className="py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="table">
      <LogbookTabs />
      {/* The shared filter bar sits directly under the navigation, the way
          it does on the other three domain lists — it is `sticky top-14`, so
          its place in the flow is what the page reads like before you scroll.
          Search and status stay open because every domain has them; category
          and country sit behind "Filter". */}
      {/* The width is the shell's, as on the other three logbooks: an own
          max-width and padding in here put the title 24px right of theirs
          (CT106 design-6 R07). Secondary actions first, the primary last. */}
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("places:list.title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={COLUMN_IDS.map((id) => ({
                id,
                label: columnLabel(t, id),
                always: (ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
            {/* The only entry point to lists and checklists. Deliberately here
                rather than in the nav: a list is a view OF the logbook, so it
                hangs off the logbook rather than competing with it. */}
            {/* The logbook seen from where one stands (forgejo#233). */}
            <Link
              to="/places/nearby"
              className="rounded-lg px-4 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("places:nearby.title")}
            </Link>
            <Link
              to="/places/lists"
              className="rounded-lg px-4 py-2 text-sm"
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("places:lists.title")}
            </Link>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("places:list.addPlace")}</span>
            </button>
          </div>
        </div>

        {deleteFailure !== null && (
          <div className="mb-3">
            <FormErrorBanner
              message={t("places:list.deleteFailedFor", {
                name: deleteFailure.place.name,
                reason: t(deleteFailure.key),
              })}
              onRetry={
                isTransientSaveError(deleteFailure.key)
                  ? () => void runDelete(deleteFailure.place)
                  : undefined
              }
              retryDisabled={deleting}
            />
          </div>
        )}

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
            placeholder: t("places:list.searchPlaceholder"),
          }}
          status={{
            label: t("places:list.filters.status"),
            value: visited,
            onChange: (v) => setVisited(v as VisitedFilter),
            allLabel: t("places:filter.allStatuses"),
            options: [
              { value: "visited", label: t("places:list.status.visited") },
              { value: "planned", label: t("places:list.status.planned") },
              { value: "wishlist", label: t("places:list.status.wishlist") },
            ],
          }}
          extra={
            <>
              <FilterField label={t("places:list.filters.category")}>
                <select
                  className={PANEL_SELECT_CLASS}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryFilter)}
                >
                  <option value="all">{t("places:filter.allCategories")}</option>
                  {PLACE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`places:categories.${c}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
              {/* Only shown when there is something to filter BY. An empty
                  dropdown is a control that cannot do anything. */}
              {lists.length > 0 && (
                <FilterField label={t("places:list.filters.list")}>
                  <select
                    className={PANEL_SELECT_CLASS}
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                  >
                    <option value="all">{t("places:list.filters.allLists")}</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </FilterField>
              )}
              <FilterField label={t("places:list.filters.country")}>
                <select
                  className={PANEL_SELECT_CLASS}
                  value={country}
                  onChange={(e) => setCountry(e.target.value as CountryFilter)}
                >
                  <option value="all">{t("places:filter.allCountries")}</option>
                  {countryOptions.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>
            </>
          }
          extraActiveCount={(category !== "all" ? 1 : 0) + (country !== "all" ? 1 : 0)}
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={
            loading || loadError
              ? ""
              : // `count`, not `shown`: i18next picks the plural form off
                // `count` and nothing else, and "1 von 95 treffen zu" is what
                // a bespoke variable name bought (review, 2026-09-19).
                t("places:list.resultCount", { count: filtered.length, total: rows.length })
          }
        />

        <>
          {loading ? (
            <SkeletonTable rows={10} />
          ) : loadError ? (
            // Distinct from "no places yet" (forgejo#247/#250): the shared
            // degraded state with a retry, never a red paragraph.
            <ListLoadFailed
              title={t("places:list.loadError")}
              onRetry={() => void load()}
              log={loadFailure}
            />
          ) : filtered.length === 0 ? (
            /* Was its own inline ternary saying the same thing the other
                 three lists say — the shared component so the wording and the
                 offer to clear the filter cannot drift apart again. */
            <div
              className="overflow-hidden rounded-lg"
              style={{ border: "1px solid var(--color-border)" }}
            >
              <ListEmptyState
                filtered={hasActiveFilter}
                emptyTitle={t("places:list.empty")}
                emptyHint={t("places:list.emptyHint")}
                onReset={resetFilters}
                // Nothing filtered and nothing there: the next step is the
                // first place, offered right here (forgejo#250).
                action={{ label: t("places:list.addFirst"), onClick: () => setCreating(true) }}
              />
            </div>
          ) : (
            <>
              <TablePagination {...pagination} placement="top" />
              <Table columns={visibleColumns} label={t("places:list.title")} {...tableHints}>
                {pagination.paged.map((p) => (
                  <PlaceRow
                    key={p.id}
                    columns={visibleColumns}
                    onOpen={() => navigate(`/places/${p.id}`)}
                    onEdit={() => navigate(`/places/${p.id}`)}
                    onDelete={() => setPendingDelete(p)}
                    onRecordVisit={() => setRecordingFor(p)}
                    recordVisitLabel={t("places:visit.action")}
                    editLabel={t("common:buttons.edit")}
                    deleteLabel={t("common:buttons.delete")}
                    cells={{
                      name: (
                        <span className="flex items-center gap-2 font-medium">
                          <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                          <span className="min-w-0">
                            {p.name}
                            <LocalName value={p.localName} />
                          </span>
                        </span>
                      ),
                      category: t(`places:categories.${p.category}`),
                      location: (
                        // min-w-0 + shrink-0: a long city ("Sassnitz-Stubbenkammer")
                        // wraps inside the cell instead of pushing the flag into
                        // the next column.
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 break-words">{p.city ?? "—"}</span>
                          {p.country && (
                            <span className="shrink-0">
                              <FlagImg country={p.country} />
                            </span>
                          )}
                        </span>
                      ),
                      country: placeCountryLabel(p, i18n.language) || "—",
                      continent: continentLabel(p.continent, t),
                      visits: (
                        <>
                          {p.visitCount}
                          {/* Planned visits are shown but never folded into the
                              count — the future-date rule, made visible rather
                              than silently applied. */}
                          {p.plannedVisitCount > 0 && (
                            <span className="ml-1 text-xs text-[var(--warning)]">
                              {t("places:list.plannedSuffix", { count: p.plannedVisitCount })}
                            </span>
                          )}
                        </>
                      ),
                      lastVisit: formatDate(p.lastVisitAt),
                      /* The shared palette every other list resolves its status
                         through — green for happened, blue for still ahead,
                         muted for a wishlist entry. It used to carry its own two
                         colours, which is how a fourth shade of "done" gets into
                         an app. */
                      status: (
                        <span
                          className={STATUS_PILL_CLASS}
                          style={statusPillStyle(PLACE_PILL_STATUS[classifyPlace(p)])}
                        >
                          {t(`places:list.status.${PLACE_STATUS_KEY[classifyPlace(p)]}`)}
                        </span>
                      ),
                    }}
                  />
                ))}
              </Table>
              <TablePagination {...pagination} />
            </>
          )}
        </>
      </div>

      {creating && (
        <PlaceFormModal
          place={null}
          onClose={() => setCreating(false)}
          onReload={() => void load()}
          onSaved={async (saved) => {
            setCreating(false);
            // The form's guard may still hold a history entry; this replaces
            // it instead of stacking the new page on top (rollout rule).
            await navigateAfterSave(navigate, `/places/${saved.id}`);
          }}
        />
      )}

      {recordingFor && (
        <VisitDialog
          place={recordingFor}
          onClose={() => setRecordingFor(null)}
          onReload={() => void load()}
          onSaved={async () => {
            // Re-read the rows without the page's loading state, so the
            // dialog stays mounted; a failure is said there as "gespeichert,
            // Liste nicht aktualisiert", never as a failed save.
            setRows(await listPlaces({}));
            addToast("success", t("places:visit.recorded", { name: recordingFor.name }));
            setRecordingFor(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          isOpen
          title={t("places:list.deleteTitle")}
          // What goes (visits, proof photos, kept documents, list
          // memberships) and what stays (trips, the lists themselves), from
          // the same function the detail page asks with (forgejo#250). The
          // row's own figure leaves planned visits out; every visit goes.
          message={placeDeleteMessage(
            t,
            pendingDelete.name,
            pendingDelete.visitCount + pendingDelete.plannedVisitCount,
            deleteRelations
          )}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
          onConfirm={() => void runDelete(pendingDelete)}
          isLoading={deleting}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </AppShell>
  );
}

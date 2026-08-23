import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { SkeletonTable } from "../components/SkeletonLoader";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { SortableHeader } from "../components/table/SortableHeader";
import ListFilterBar, { FilterField, PANEL_SELECT_CLASS } from "../components/table/ListFilterBar";
import ListEmptyState from "../components/table/ListEmptyState";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import ConfirmModal from "../components/Training/ConfirmModal";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { PlaceFormModal } from "../components/places/PlaceFormModal";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { deletePlace, listPlaces } from "../lib/api/places";
import { useToastStore } from "../store/toastStore";
import { PLACE_CATEGORIES, PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import type { PlaceCategory } from "../shared/placeCategories";
import type { Place } from "../types/place";

type CategoryFilter = PlaceCategory | "all";
type CountryFilter = string | "all";
/** Tri-state on the wire; "all" means the list shows wishlist entries too, so
 *  the one view meant to contain them never hides them. */
type VisitedFilter = "all" | "visited" | "wishlist";

type PlaceSortKey = "name" | "category" | "location" | "visits" | "lastVisit";
type PlaceColumnId = PlaceSortKey | "status" | "actions";

const COLUMN_IDS: readonly PlaceColumnId[] = [
  "name",
  "category",
  "location",
  "visits",
  "lastVisit",
  "status",
  "actions",
];
const ALWAYS_VISIBLE = ["name", "actions"] as const;
const NUMERIC_COLUMNS: readonly PlaceColumnId[] = ["visits"];

const SORT_KEY_BY_COLUMN: Partial<Record<PlaceColumnId, PlaceSortKey>> = {
  name: "name",
  category: "category",
  location: "location",
  visits: "visits",
  lastVisit: "lastVisit",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

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
  visits: false,
  lastVisit: false,
};

function compareRows(a: Place, b: Place, key: PlaceSortKey, locale: string): number {
  switch (key) {
    case "category":
      return a.category.localeCompare(b.category);
    case "location":
      return (a.city ?? "").localeCompare(b.city ?? "", locale);
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
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const access = usePlacesAccess();

  const [rows, setRows] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Place | null>(null);
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [country, setCountry] = useState<CountryFilter>("all");
  const [visited, setVisited] = useState<VisitedFilter>("all");
  const [sortBy, setSortBy] = useState<PlaceSortKey>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const countryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of rows) {
      if (!p.isoCountryCode) continue;
      seen.set(p.isoCountryCode, p.country ?? p.isoCountryCode);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], i18n.language));
  }, [rows, i18n.language]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (country !== "all" && p.isoCountryCode !== country) return false;
      if (visited === "visited" && !p.visited) return false;
      if (visited === "wishlist" && p.visited) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q) ||
        (p.address ?? "").toLowerCase().includes(q)
      );
    });
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...out].sort((a, b) => compareRows(a, b, sortBy, i18n.language) * dir);
  }, [rows, search, category, country, visited, sortBy, sortOrder, i18n.language]);

  const handleSort = useCallback((key: PlaceSortKey): void => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortOrder(SORT_DEFAULT_ASC[key] ? "asc" : "desc");
      return key;
    });
  }, []);

  const hasActiveFilter =
    search.trim() !== "" || category !== "all" || country !== "all" || visited !== "all";

  /** Read straight off the visible rows, like the other three lists. Visits
   *  are counted from data and dates (shared/placeCounting), never from a
   *  status string — a visit dated in the future is not one. */
  const summaryFigures = useMemo(() => {
    const countries = new Set<string>();
    let visited = 0;
    for (const p of filtered) {
      if (p.country) countries.add(p.country);
      if (p.visited) visited += 1;
    }
    return [
      { key: "places", value: String(filtered.length), label: t("common:summary.places") },
      { key: "visited", value: String(visited), label: t("common:summary.visited") },
      { key: "countries", value: String(countries.size), label: t("common:summary.countries") },
    ];
  }, [filtered, t]);

  const resetFilters = useCallback((): void => {
    setSearch("");
    setCategory("all");
    setCountry("all");
    setVisited("all");
  }, []);

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    try {
      await deletePlace(pendingDelete.id);
      addToast("success", t("places:list.deleted", { name: pendingDelete.name }));
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      logger.error({ err }, "PlacesListPage: delete failed");
      addToast("error", t("places:list.deleteFailed"));
    }
  }, [pendingDelete, addToast, t, load]);

  const formatDate = useCallback(
    (iso: string | null): string =>
      iso ? new Date(iso).toLocaleDateString(i18n.language) : "—",
    [i18n.language]
  );

  if (access === "denied") {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <NavigationBar />
      {/* The shared filter bar sits directly under the navigation, the way
          it does on the other three domain lists — it is `sticky top-14`, so
          its place in the flow is what the page reads like before you scroll.
          Search and status stay open because every domain has them; category
          and country sit behind "Filter". */}
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
            : t("places:list.resultCount", { shown: filtered.length, total: rows.length })
        }
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {t("places:list.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--domain-poi)", color: "#08221e" }}
            >
              + {t("places:list.addPlace")}
            </button>
            <ColumnPicker
              columns={COLUMN_IDS.map((id) => ({
                id,
                label: columnLabel(t, id),
                always: (ALWAYS_VISIBLE as readonly string[]).includes(id),
              }))}
              prefs={columnPrefs}
            />
          </div>
        </div>


        <ListSummaryStrip
          figures={summaryFigures}
          filtered={hasActiveFilter}
          filteredLabel={t("common:filters.filtered")}
          unknown={loading || loadError}
        />

        <div
          className="overflow-hidden rounded-lg shadow-xs"
          style={{ border: "1px solid var(--color-border)" }}
        >
          <div className="overflow-x-auto">
            {loading ? (
              <SkeletonTable rows={10} />
            ) : loadError ? (
              <div className="bg-[var(--bg-surface)] px-4 py-8 text-center">
                <p className="text-[var(--danger)]">{t("places:list.loadError")}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 text-sm underline"
                  style={{ color: "var(--accent)" }}
                >
                  {t("places:list.retry")}
                </button>
              </div>
            ) : filtered.length === 0 ? (
              /* Was its own inline ternary saying the same thing the other
                 three lists say — the shared component so the wording and the
                 offer to clear the filter cannot drift apart again. */
              <ListEmptyState
                filtered={hasActiveFilter}
                emptyTitle={t("places:list.empty")}
                emptyHint={t("places:list.emptyHint")}
                onReset={resetFilters}
              />
            ) : (
              <table className="w-full min-w-[900px] text-sm">
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
                                ariaLabel={t("places:list.sortBy", { col: label })}
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
                  {filtered.map((p, index) => (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/places/${p.id}`)}
                      className="cursor-pointer"
                      style={{
                        background: index % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                        borderTop: "1px solid var(--color-border)",
                      }}
                    >
                      {columnPrefs.isVisible("name") && (
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 font-medium">
                            <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                            {p.name}
                          </span>
                        </td>
                      )}
                      {columnPrefs.isVisible("category") && (
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          {t(`places:categories.${p.category}`)}
                        </td>
                      )}
                      {columnPrefs.isVisible("location") && (
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          <span className="flex items-center gap-2">
                            {p.city ?? "—"}
                            {p.country && (
                              <FlagImg country={p.country} />
                            )}
                          </span>
                        </td>
                      )}
                      {columnPrefs.isVisible("visits") && (
                        <td className="px-4 py-3 text-right">
                          {p.visitCount}
                          {/* Planned visits are shown but never folded into the
                              count — the future-date rule, made visible rather
                              than silently applied. */}
                          {p.plannedVisitCount > 0 && (
                            <span className="ml-1 text-xs text-[var(--warning)]">
                              {t("places:list.plannedSuffix", { count: p.plannedVisitCount })}
                            </span>
                          )}
                        </td>
                      )}
                      {columnPrefs.isVisible("lastVisit") && (
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          {formatDate(p.lastVisitAt)}
                        </td>
                      )}
                      {columnPrefs.isVisible("status") && (
                        <td className="px-4 py-3">
                          <span
                            className="rounded px-2 py-1 text-xs"
                            style={
                              p.visited
                                ? {
                                    color: "var(--success)",
                                    background: "rgba(63,185,80,0.08)",
                                    border: "1px solid rgba(63,185,80,0.35)",
                                  }
                                : {
                                    color: "var(--text-muted)",
                                    border: "1px dashed var(--color-border)",
                                  }
                            }
                          >
                            {p.visited
                              ? t("places:list.status.visited")
                              : t("places:list.status.wishlist")}
                          </span>
                        </td>
                      )}
                      {columnPrefs.isVisible("actions") && (
                        <td className="px-4 py-3">
                          <RowActions>
                            <RowActionButton
                              icon="edit"
                              label={t("common:buttons.edit")}
                              onClick={() => navigate(`/places/${p.id}`)}
                            />
                            <RowActionButton
                              icon="delete"
                              label={t("common:buttons.delete")}
                              onClick={() => setPendingDelete(p)}
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
        </div>
      </div>

      {creating && (
        <PlaceFormModal
          place={null}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/places/${saved.id}`);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          isOpen
          title={t("places:list.deleteTitle")}
          // Same shape as the other five delete dialogs: what · how much goes
          // with it · what stays. It already named the place and the visits;
          // it lacked the COUNT and the reassurance that trips survive.
          message={countedDeleteMessage(
            t,
            {
              counted: "places:list.deleteMessage",
              empty: "places:list.deleteMessageNoVisits",
            },
            pendingDelete.name,
            pendingDelete.visitCount
          )}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
          onConfirm={() => void confirmDelete()}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </PageTransition>
  );
}

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise, CruiseStatus } from "../types";
import { CruiseRow, type CruiseColumnId } from "../components/Cruise/CruiseRow";
import { ColumnPicker } from "../components/table/ColumnPicker";
import { useColumnPrefs } from "../components/table/useColumnPrefs";
import CruiseRowActions from "../components/Cruise/CruiseRowActions";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useCruiseImportAdapter } from "../components/import/adapters/cruiseAdapter";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../store/toastStore";
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

export default function CruisesPage(): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const importAdapter = useCruiseImportAdapter();
  const [editingCruise, setEditingCruise] = useState<Cruise | null>(null);
  const [cruiseToDelete, setCruiseToDelete] = useState<Cruise | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Cruise | null>(null);

  // Filter state — mirrors the flights filter panel conceptually but the
  // data domain is smaller so we inline rather than reuse <Filters />.
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
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
    try {
      const data = await cruiseApi.list();
      setCruises(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Derive year dropdown options from loaded cruises so we only ever show
  // years the user actually has data for. Sorted descending (newest first).
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const c of cruises) {
      if (c.startDate) years.add(new Date(c.startDate).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cruises]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cruises.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
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
  }, [cruises, search, statusFilter, yearFilter]);

  const sorted = useMemo(
    () => sortCruises(filtered, sortBy, sortOrder),
    [filtered, sortBy, sortOrder]
  );

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
  };

  const hasActiveFilter = search.length > 0 || statusFilter !== "all" || yearFilter !== "all";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />

      {/* Sticky filter bar — mirrors FlightsTablePage layout */}
      <div
        className="sticky top-14 z-10 px-4 py-3 backdrop-blur-md"
        style={{
          background: "rgba(13,17,23,0.85)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="mx-auto flex max-w-(--breakpoint-2xl) flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <input
              type="search"
              value={search}
              onChange={(e): void => setSearch(e.target.value)}
              placeholder={t("filter.searchPlaceholder")}
              className="w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden md:max-w-xs"
            />
            <select
              value={statusFilter}
              onChange={(e): void => setStatusFilter(e.target.value as StatusFilter)}
              aria-label={t("filter.status")}
              className="rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary)"
            >
              <option value="all">{t("filter.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
            <select
              value={yearFilter === "all" ? "all" : String(yearFilter)}
              onChange={(e): void =>
                setYearFilter(
                  e.target.value === "all" ? "all" : Number.parseInt(e.target.value, 10)
                )
              }
              aria-label={t("filter.year")}
              className="rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary)"
            >
              <option value="all">{t("filter.allYears")}</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-border px-3 py-2 text-xs text-(--text-muted) hover:text-(--text-primary)"
              >
                {t("filter.reset")}
              </button>
            )}
          </div>
          <div className="text-xs text-(--text-muted)">
            {t("filter.showing", { count: filtered.length })}
          </div>
        </div>
      </div>

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

        {loading ? (
          <div className="text-(--text-muted)">{t("list.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-border bg-(--bg-surface) px-4 py-8 text-center text-(--text-muted)">
            {t("list.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-(--bg-surface) text-(--text-muted)">
                <tr>
                  {columnPrefs.isVisible("ship") && (
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("ship")}
                      className="inline-flex items-center gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.ship") })}
                    >
                      {t("list.columns.ship")}
                      <span
                        aria-hidden
                        className={sortBy === "ship" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "ship" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("line") && (
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("line")}
                      className="inline-flex items-center gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.line") })}
                    >
                      {t("list.columns.line")}
                      <span
                        aria-hidden
                        className={sortBy === "line" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "line" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("dates") && (
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("date")}
                      className="inline-flex items-center gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.dates") })}
                    >
                      {t("list.columns.dates")}
                      <span
                        aria-hidden
                        className={sortBy === "date" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "date" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("ports") && (
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort("ports")}
                      className="inline-flex items-center justify-end gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.ports") })}
                    >
                      {t("list.columns.ports")}
                      <span
                        aria-hidden
                        className={sortBy === "ports" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "ports" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("status") && (
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => handleSort("status")}
                      className="inline-flex items-center gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.status") })}
                    >
                      {t("list.columns.status")}
                      <span
                        aria-hidden
                        className={sortBy === "status" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "status" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("cabin") && (
                  <th className="px-3 py-2 text-left">{t("list.columns.cabin")}</th>
                  )}
                  {columnPrefs.isVisible("price") && (
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort("price")}
                      className="inline-flex items-center justify-end gap-1 hover:text-(--text-primary)"
                      aria-label={t("list.sortBy", { col: t("list.columns.price") })}
                    >
                      {t("list.columns.price")}
                      <span
                        aria-hidden
                        className={sortBy === "price" ? "text-(--accent)" : "opacity-0"}
                      >
                        {sortBy === "price" ? (sortOrder === "asc" ? "▼" : "▲") : "▲"}
                      </span>
                    </button>
                  </th>
                  )}
                  {columnPrefs.isVisible("actions") && (
                  <th className="px-3 py-2 text-right">{t("list.columns.actions")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <CruiseRow
                    key={c.id}
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
        {cruiseToDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <div
              className="w-full max-w-sm rounded-xl p-6 space-y-4"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              role="dialog"
              aria-modal="true"
            >
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("list.delete.confirm", {
                  ship: cruiseToDelete.ship?.name ?? cruiseToDelete.shipNameOverride ?? "",
                })}
              </h2>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCruiseToDelete(null)}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("common:buttons.cancel")}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await cruiseApi.remove(cruiseToDelete.id);
                      addToast("success", t("list.delete.done"));
                    } catch {
                      addToast("error", t("list.delete.error"));
                    } finally {
                      setCruiseToDelete(null);
                      await reload();
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: "var(--danger, #f85149)" }}
                >
                  {t("common:buttons.delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

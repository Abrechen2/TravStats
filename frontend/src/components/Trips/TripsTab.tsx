import Modal from "../Modal";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Trip, TripCategory, TripStatus } from "../../types";
import TripCard, { tripDays, tripSpan } from "./TripCard";
import DomainImportPanel from "../import/DomainImportPanel";
import { useTripImportAdapter } from "../import/adapters/tripAdapter";
import TripCleanupModal from "./TripCleanupModal";
import DetectTripsBanner from "./DetectTripsBanner";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { TRIP_GRID_CLASS } from "./tripGrid";
import Button from "../ui/Button";
import PageHeader from "../ui/PageHeader";

/** What the list is narrowed to; the SERVER applies it, so a trip past the page cap is found. */
export interface TripsFilters {
  q: string;
  status: StatusFilter;
  category: CategoryFilter;
}

export const NO_TRIP_FILTERS: TripsFilters = { q: "", status: "all", category: "all" };

/** Quiet time after the last keystroke before the search goes to the server. */
export const TRIPS_SEARCH_DEBOUNCE_MS = 300;

interface TripsTabProps {
  trips: Trip[];
  filters: TripsFilters;
  /** A patch: the tab names only what changed. */
  onFiltersChange: (patch: Partial<TripsFilters>) => void;
  /** Counts under the current search, from the server (the loaded rows are only a page). */
  facets?: { status: Record<string, number>; category: Record<string, number> };
  /** The list is shorter than the match count: offer the next page. */
  loadMore?: { loading: boolean; error?: boolean; onLoad: () => void };
  /** The last list request failed; shown instead of pretending the list is empty. */
  listError?: boolean;
  onTripsChange: () => void;
  /**
   * The page title and meta line. The tab draws the header itself because
   * the actions beside the title (add, clean up, merge) are its own state —
   * round 4 puts them there, not in a row between the banner and filters.
   */
  header?: { title: string; meta: ReactNode };
  /** Rendered between the header and the detection banner. */
  insights?: ReactNode;
}

export type StatusFilter = "all" | TripStatus;
export type CategoryFilter = "all" | TripCategory;

const STATUS_OPTIONS: StatusFilter[] = ["all", "planned", "in_progress", "completed"];
const CATEGORY_OPTIONS: CategoryFilter[] = [
  "all",
  "vacation",
  "business",
  "weekend",
  "family",
  "other",
];

const sumOf = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((a, b) => a + b, 0);

export default function TripsTab({
  trips,
  filters,
  onFiltersChange,
  facets,
  loadMore,
  listError,
  onTripsChange,
  header,
  insights,
}: TripsTabProps): JSX.Element {
  const { t } = useTranslation(["trips", "import", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const tripAdapter = useTripImportAdapter(onTripsChange);
  const [showCleanup, setShowCleanup] = useState(false);

  // Merge mode: clicking a card toggles selection instead of opening it.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  const { status: statusFilter, category: categoryFilter } = filters;
  const [search, setSearch] = useState(filters.q);

  useEffect(() => {
    const q = search.trim();
    if (q === filters.q) return undefined;
    const timer = setTimeout(() => onFiltersChange({ q }), TRIPS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q, onFiltersChange]);

  const handleOpen = (trip: Trip): void => {
    navigate(`/trips/${trip.id}`);
  };

  const toggleMergeSelection = (trip: Trip): void => {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(trip.id)) {
        next.delete(trip.id);
      } else {
        next.add(trip.id);
      }
      return next;
    });
  };

  const exitMergeMode = (): void => {
    setMergeMode(false);
    setMergeSelection(new Set());
    setShowMergeConfirm(false);
  };

  const handleMerge = async (name: string): Promise<void> => {
    const tripIds = [...mergeSelection];
    try {
      await tripsApi.merge({ tripIds, name });
      addToast("success", t("trips:merge.done"));
      exitMergeMode();
      onTripsChange();
    } catch {
      addToast("error", t("trips:merge.error"));
    }
  };

  // The server narrows the list; this only orders what it sent.
  // Newest first; the grid groups by start year, so status no longer
  // decides the order — a planned trip sits in its own year.
  // Days at the places (`YYYY-MM-DD`) sort as strings; undated last.
  const filtered = useMemo(
    () =>
      [...trips].sort((a, b) => {
        const at = tripSpan(a).start ?? "";
        const bt = tripSpan(b).start ?? "";
        return at === bt ? 0 : at < bt ? 1 : -1;
      }),
    [trips]
  );

  const filtersActive = search.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all";
  const showFilters = trips.length >= 4 || filtersActive || (facets && sumOf(facets.status) >= 4);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: facets ? sumOf(facets.status) : trips.length,
      ...(facets?.status ?? {}),
    };
    for (const [cat, n] of Object.entries(facets?.category ?? {})) counts[`cat:${cat}`] = n;
    if (!facets) {
      for (const trip of trips) counts[trip.status] = (counts[trip.status] ?? 0) + 1;
      for (const trip of trips) {
        if (trip.category)
          counts[`cat:${trip.category}`] = (counts[`cat:${trip.category}`] ?? 0) + 1;
      }
    }
    return counts;
  }, [trips, facets]);

  /** Trips by start year, newest year first; undated ones last. */
  const groups = useMemo(() => {
    const byYear = new Map<string, Trip[]>();
    for (const trip of filtered) {
      const start = tripSpan(trip).start;
      const key = start ? start.slice(0, 4) : "";
      byYear.set(key, [...(byYear.get(key) ?? []), trip]);
    }
    return [...byYear.entries()];
  }, [filtered]);

  const pageActions = (
    <>
      {trips.length >= 2 && !mergeMode && (
        // Clean-up and merge are rare housekeeping. On a phone they sit
        // behind "…", so the list starts sooner (CT106 audit B10).
        <RareActions
          onCleanup={() => setShowCleanup(true)}
          onMerge={() => setMergeMode(true)}
          cleanupLabel={t("trips:cleanup.button")}
          mergeLabel={t("trips:merge.button")}
          moreLabel={t("common:buttons.moreActions")}
        />
      )}
      <Button variant="primary" onClick={() => setShowAddPanel(true)}>
        + {t("import:trip.triggerLabel")}
      </Button>
    </>
  );

  return (
    <div className="pb-12">
      <div className="max-w-7xl mx-auto">
        {header ? (
          <PageHeader title={header.title} meta={header.meta} actions={pageActions} />
        ) : (
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{pageActions}</div>
        )}
        {insights}
        <DetectTripsBanner onChange={onTripsChange} />

        {mergeMode && (
          <div
            className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl text-xs flex-wrap"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--accent)",
              color: "var(--text-primary)",
            }}
          >
            <span>{t("trips:merge.hint")}</span>
            <span className="font-semibold" style={{ color: "var(--accent)" }}>
              {t("trips:merge.selected", { count: mergeSelection.size })}
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={exitMergeMode} style={{ color: "var(--text-muted)" }}>
                {t("trips:merge.exit")}
              </button>
              <button
                onClick={() => setShowMergeConfirm(true)}
                disabled={mergeSelection.size < 2}
                className="px-3 py-1 rounded-lg font-medium disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#0d1117" }}
              >
                ⇶ {t("trips:merge.confirm")}
              </button>
            </div>
          </div>
        )}

        {showFilters && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="flex max-w-full gap-2 overflow-x-auto scrollbar-none">
              {STATUS_OPTIONS.filter(
                (opt) => opt === "all" || statusCounts[opt] || statusFilter === opt
              ).map((opt) => (
                <FilterPill
                  key={opt}
                  active={statusFilter === opt}
                  count={statusCounts[opt] ?? 0}
                  onClick={() => onFiltersChange({ status: opt })}
                >
                  {opt === "all" ? t("trips:filterBar.allStatuses") : t(`trips:status.${opt}`)}
                </FilterPill>
              ))}
              {CATEGORY_OPTIONS.filter(
                (opt) => opt !== "all" && (statusCounts[`cat:${opt}`] || categoryFilter === opt)
              ).map((opt) => (
                <FilterPill
                  key={opt}
                  active={categoryFilter === opt}
                  count={statusCounts[`cat:${opt}`] ?? 0}
                  onClick={() =>
                    onFiltersChange({ category: categoryFilter === opt ? "all" : opt })
                  }
                >
                  {t(`trips:category.${opt}`)}
                </FilterPill>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("trips:filterBar.search")}
              aria-label={t("trips:filterBar.search")}
              className="ml-auto w-full rounded-[var(--ts-radius-button)] px-3 py-2 text-sm sm:w-60"
              style={{
                background: "var(--ts-surface)",
                border: "1px solid var(--ts-border)",
                color: "var(--ts-text-bright)",
              }}
            />
          </div>
        )}

        {listError ? (
          <p
            role="alert"
            className="text-center py-12 text-sm"
            style={{ color: "var(--text-muted)" }}
            data-testid="trips-list-error"
          >
            {t("trips:listError")}
          </p>
        ) : trips.length === 0 && !filtersActive ? (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">🗺</p>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("trips:noTrips")}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {t("trips:noTripsDesc")}
            </p>
          </div>
        ) : trips.length === 0 ? (
          <div
            className="text-center py-12 rounded-xl"
            style={{
              background: "var(--bg-surface)",
              border: "1px dashed var(--color-border)",
              color: "var(--text-muted)",
            }}
          >
            {t("trips:filterBar.noResults")}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(([year, list]) => {
              const days = list.reduce((sum, trip) => sum + (tripDays(trip) ?? 0), 0);
              return (
                <section key={year || "undated"} className="flex flex-col gap-3">
                  <h2
                    className="t-caption flex gap-4"
                    style={{ fontFamily: "var(--ts-font-mono)" }}
                  >
                    <span style={{ color: "var(--ts-text-bright)" }}>
                      {year || t("trips:list.undated")}
                    </span>
                    <span>
                      {t("trips:count", { count: list.length })}
                      {days > 0 && ` · ${t("trips:head.days", { count: days })}`}
                    </span>
                  </h2>
                  <div className={TRIP_GRID_CLASS}>
                    {list.map((trip) => (
                      <div
                        key={trip.id}
                        className="rounded-[var(--ts-radius-card)]"
                        style={
                          mergeMode
                            ? {
                                outline: mergeSelection.has(trip.id)
                                  ? "2px solid var(--ts-accent)"
                                  : "2px solid transparent",
                                outlineOffset: 2,
                              }
                            : undefined
                        }
                      >
                        <TripCard
                          trip={trip}
                          onOpen={mergeMode ? toggleMergeSelection : handleOpen}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {loadMore && !listError && (
          <div className="mt-6 flex flex-col items-center gap-2">
            {loadMore.error && (
              <p role="alert" className="text-sm" data-testid="trips-more-error">
                {t("trips:listError")}
              </p>
            )}
            <Button
              variant="secondary"
              onClick={loadMore.onLoad}
              disabled={loadMore.loading}
              data-testid="trips-load-more"
            >
              {loadMore.loading ? t("common:loading.default") : t("trips:loadMore")}
            </Button>
          </div>
        )}
      </div>

      {showCleanup && (
        <TripCleanupModal onClose={() => setShowCleanup(false)} onChanged={onTripsChange} />
      )}

      {showMergeConfirm && (
        <MergeConfirmModal
          defaultName={trips.find((trip) => trip.id === [...mergeSelection][0])?.name ?? ""}
          count={mergeSelection.size}
          onCancel={() => setShowMergeConfirm(false)}
          onConfirm={(name) => void handleMerge(name)}
        />
      )}

      {/* Adding asks "what do you have?" first — building from existing
          entries is the route that fills in the most, so the empty form is no
          longer the default way in. Editing an existing trip still opens the
          form directly: there is nothing to choose. */}
      <DomainImportPanel
        open={showAddPanel}
        onClose={() => setShowAddPanel(false)}
        onItemsCreated={onTripsChange}
        adapter={tripAdapter}
      />
    </div>
  );
}

function MergeConfirmModal({
  defaultName,
  count,
  onCancel,
  onConfirm,
}: {
  defaultName: string;
  count: number;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "import", "common"]);
  const [name, setName] = useState(defaultName);

  return (
    <Modal
      open
      onClose={onCancel}
      title={`${t("trips:merge.title")} (${t("trips:merge.selected", { count })})`}
      maxWidth={384}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => onConfirm(name.trim() || defaultName)}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--ts-accent-text)" }}
          >
            ⇶ {t("trips:merge.confirm")}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("trips:merge.intro")}
      </p>
      <div>
        <label
          className="block text-xs mb-1"
          htmlFor="merge-trip-name"
          style={{ color: "var(--text-muted)" }}
        >
          {t("trips:merge.nameLabel")}
        </label>
        <input
          id="merge-trip-name"
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--color-border)",
            color: "var(--text-primary)",
          }}
        />
      </div>
    </Modal>
  );
}

/**
 * A filter pill with its count, round 4 ("Reisen"). The row around the pills
 * scrolls inside itself: on a 390px phone the old category group pushed the
 * document to 511px (forgejo#16), and a pill must not shrink either.
 */
function FilterPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold"
      style={{
        background: active ? "var(--ts-accent)" : "transparent",
        color: active ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
        border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border)"}`,
      }}
    >
      {children}
      <span className="text-xs" style={{ fontFamily: "var(--ts-font-mono)", opacity: 0.75 }}>
        {count}
      </span>
    </button>
  );
}

const RARE_ACTION_CLASS =
  "whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent)";

/** Clean-up and merge: buttons from 640px, a "…" menu below. */
function RareActions({
  onCleanup,
  onMerge,
  cleanupLabel,
  mergeLabel,
  moreLabel,
}: {
  onCleanup: () => void;
  onMerge: () => void;
  cleanupLabel: string;
  mergeLabel: string;
  moreLabel: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const style = { borderColor: "var(--color-border)", color: "var(--text-muted)" };
  return (
    <>
      <span className="hidden sm:contents">
        <button type="button" onClick={onCleanup} className={RARE_ACTION_CLASS} style={style}>
          {cleanupLabel}
        </button>
        <button type="button" onClick={onMerge} className={RARE_ACTION_CLASS} style={style}>
          {mergeLabel}
        </button>
      </span>
      <span className="relative sm:hidden">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={moreLabel}
          onClick={() => setOpen((v) => !v)}
          className={RARE_ACTION_CLASS}
          style={style}
        >
          …
        </button>
        {open && (
          <span
            role="menu"
            className="absolute right-0 z-30 mt-1 flex flex-col rounded-lg p-1 shadow-xl"
            style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
          >
            <button
              type="button"
              role="menuitem"
              className="whitespace-nowrap rounded-md px-3 py-2 text-left text-sm"
              onClick={() => {
                setOpen(false);
                onCleanup();
              }}
            >
              {cleanupLabel}
            </button>
            <button
              type="button"
              role="menuitem"
              className="whitespace-nowrap rounded-md px-3 py-2 text-left text-sm"
              onClick={() => {
                setOpen(false);
                onMerge();
              }}
            >
              {mergeLabel}
            </button>
          </span>
        )}
      </span>
    </>
  );
}

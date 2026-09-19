import Modal from "../Modal";
import { useMemo, useState, type ReactNode } from "react";
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

interface TripsTabProps {
  trips: Trip[];
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

type StatusFilter = "all" | TripStatus;
type CategoryFilter = "all" | TripCategory;

const STATUS_OPTIONS: StatusFilter[] = ["all", "planned", "in_progress", "completed"];
const CATEGORY_OPTIONS: CategoryFilter[] = [
  "all",
  "vacation",
  "business",
  "weekend",
  "family",
  "other",
];

export default function TripsTab({
  trips,
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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");

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

  // Sort: planned first, then in_progress, then completed by start date desc.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips
      .filter((trip) => {
        if (statusFilter !== "all" && trip.status !== statusFilter) return false;
        if (categoryFilter !== "all" && trip.category !== categoryFilter) return false;
        if (q.length === 0) return true;
        const haystack = [
          trip.name,
          trip.destinationLabel ?? "",
          trip.originLabel ?? "",
          ...trip.tags,
          ...trip.companions,
          ...trip.countries,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        // Newest first; the grid groups by start year, so status no longer
        // decides the order — a planned trip sits in its own year.
        const at = tripSpan(a).start?.getTime() ?? Number.NEGATIVE_INFINITY;
        const bt = tripSpan(b).start?.getTime() ?? Number.NEGATIVE_INFINITY;
        return bt - at;
      });
  }, [trips, statusFilter, categoryFilter, search]);

  const showFilters = trips.length >= 4;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: trips.length };
    for (const trip of trips) counts[trip.status] = (counts[trip.status] ?? 0) + 1;
    for (const trip of trips) {
      if (trip.category) counts[`cat:${trip.category}`] = (counts[`cat:${trip.category}`] ?? 0) + 1;
    }
    return counts;
  }, [trips]);

  /** Trips by start year, newest year first; undated ones last. */
  const groups = useMemo(() => {
    const byYear = new Map<string, Trip[]>();
    for (const trip of filtered) {
      const start = tripSpan(trip).start;
      const key = start ? String(start.getUTCFullYear()) : "";
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
              {STATUS_OPTIONS.filter((opt) => opt === "all" || statusCounts[opt]).map((opt) => (
                <FilterPill
                  key={opt}
                  active={statusFilter === opt}
                  count={statusCounts[opt] ?? 0}
                  onClick={() => setStatusFilter(opt)}
                >
                  {opt === "all" ? t("trips:filterBar.allStatuses") : t(`trips:status.${opt}`)}
                </FilterPill>
              ))}
              {CATEGORY_OPTIONS.filter((opt) => opt !== "all" && statusCounts[`cat:${opt}`]).map(
                (opt) => (
                  <FilterPill
                    key={opt}
                    active={categoryFilter === opt}
                    count={statusCounts[`cat:${opt}`] ?? 0}
                    onClick={() => setCategoryFilter(categoryFilter === opt ? "all" : opt)}
                  >
                    {t(`trips:category.${opt}`)}
                  </FilterPill>
                )
              )}
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

        {trips.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">🗺</p>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("trips:noTrips")}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {t("trips:noTripsDesc")}
            </p>
          </div>
        ) : filtered.length === 0 ? (
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

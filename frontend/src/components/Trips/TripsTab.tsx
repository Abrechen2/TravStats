import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Trip, TripCategory, TripStatus } from "../../types";
import TripCard from "./TripCard";
import TripModal from "./TripModal";
import DomainImportPanel from "../import/DomainImportPanel";
import { useTripImportAdapter } from "../import/adapters/tripAdapter";
import TripCleanupModal from "./TripCleanupModal";
import DetectTripsBanner from "./DetectTripsBanner";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { TRIP_GRID_CLASS } from "./tripGrid";

interface TripsTabProps {
  trips: Trip[];
  onTripsChange: () => void;
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

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

export default function TripsTab({ trips, onTripsChange }: TripsTabProps): JSX.Element {
  const { t } = useTranslation(["trips", "import"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const tripAdapter = useTripImportAdapter(onTripsChange);
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null);
  const [showCleanup, setShowCleanup] = useState(false);

  // Merge mode: clicking a card toggles selection instead of opening it.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await tripsApi.delete(deleteTarget.id);
      addToast("success", t("trips:toasts.deleted"));
      setDeleteTarget(null);
      onTripsChange();
    } catch {
      addToast("error", t("trips:toasts.deleteError"));
      setDeleteTarget(null);
    }
  };

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
        const order: Record<TripStatus, number> = {
          in_progress: 0,
          planned: 1,
          completed: 2,
        };
        const so = order[a.status] - order[b.status];
        if (so !== 0) return so;
        // For completed: newest first by startDate, falling back to createdAt
        const at = a.startDate ?? a.createdAt;
        const bt = b.startDate ?? b.createdAt;
        return new Date(bt).getTime() - new Date(at).getTime();
      });
  }, [trips, statusFilter, categoryFilter, search]);

  const showFilters = trips.length >= 4;

  return (
    <div className="px-4 pb-12">
      <div className="max-w-7xl mx-auto">
        <DetectTripsBanner onChange={onTripsChange} />

        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {trips.length === 0 ? t("trips:noTrips") : t("trips:count", { count: filtered.length })}
            {filtered.length !== trips.length && (
              <span style={{ opacity: 0.7 }}> / {trips.length}</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {trips.length >= 2 && !mergeMode && (
              <>
                <button
                  onClick={() => setShowCleanup(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent)"
                  style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
                >
                  {t("trips:cleanup.button")}
                </button>
                <button
                  onClick={() => setMergeMode(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent)"
                  style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
                >
                  ⇶ {t("trips:merge.button")}
                </button>
              </>
            )}
            <button
              onClick={() => setShowAddPanel(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed transition-colors hover:border-(--accent) hover:text-(--accent)"
              style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
            >
              ＋ {t("import:trip.triggerLabel")}
            </button>
          </div>
        </div>

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
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <FilterGroup>
              {STATUS_OPTIONS.map((opt) => (
                <FilterButton
                  key={opt}
                  active={statusFilter === opt}
                  onClick={() => setStatusFilter(opt)}
                >
                  {opt === "all" ? t("trips:filterBar.allStatuses") : t(`trips:status.${opt}`)}
                </FilterButton>
              ))}
            </FilterGroup>
            <FilterGroup>
              {CATEGORY_OPTIONS.map((opt) => (
                <FilterButton
                  key={opt}
                  active={categoryFilter === opt}
                  onClick={() => setCategoryFilter(opt)}
                >
                  {opt === "all"
                    ? t("trips:filterBar.allCategories")
                    : `${CATEGORY_ICON[opt]} ${t(`trips:category.${opt}`)}`}
                </FilterButton>
              ))}
            </FilterGroup>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("trips:filterBar.search")}
              className="rounded-lg px-3 py-1.5 text-xs ml-auto"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
                minWidth: 220,
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
          <div className={TRIP_GRID_CLASS}>
            {filtered.map((trip) => (
              <div
                key={trip.id}
                className="rounded-xl"
                style={
                  mergeMode
                    ? {
                        outline: mergeSelection.has(trip.id)
                          ? "2px solid var(--accent)"
                          : "2px solid transparent",
                        outlineOffset: 2,
                      }
                    : undefined
                }
              >
                <TripCard
                  trip={trip}
                  onOpen={mergeMode ? toggleMergeSelection : handleOpen}
                  onEdit={setEditingTrip}
                  onDelete={setDeleteTarget}
                />
              </div>
            ))}
            {/* New trip placeholder card — only on the unfiltered list */}
            {statusFilter === "all" && categoryFilter === "all" && search === "" && (
              <button
                onClick={() => setShowAddPanel(true)}
                className="rounded-xl border border-dashed flex flex-col items-center justify-center min-h-[280px] gap-2 transition-colors hover:border-(--accent)/50"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--bg-muted)",
                }}
              >
                <span className="text-3xl opacity-20">＋</span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("trips:newTrip")}
                </span>
                <span
                  className="text-xs text-center px-4"
                  style={{ color: "var(--text-muted)", opacity: 0.6 }}
                >
                  {t("trips:newTripDesc")}
                </span>
              </button>
            )}
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

      {editingTrip !== null && (
        <TripModal
          trip={editingTrip}
          onClose={() => setEditingTrip(null)}
          onSaved={() => {
            setEditingTrip(null);
            onTripsChange();
          }}
        />
      )}

      {deleteTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-4"
            role="dialog"
            aria-modal="true"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("trips:deleteTripConfirm", { name: deleteTarget.name })}
            </h2>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {t("trips:modal.cancel")}
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "var(--danger, #f87171)" }}
              >
                {t("trips:deleteTrip")}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const { t } = useTranslation(["trips", "import"]);
  const [name, setName] = useState(defaultName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-4"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("trips:merge.title")} ({t("trips:merge.selected", { count })})
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("trips:merge.intro")}
          </p>
        </div>
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
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => onConfirm(name.trim() || defaultName)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--accent)", color: "#0d1117" }}
          >
            ⇶ {t("trips:merge.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A segmented control that scrolls INSIDE itself.
 *
 * Forgejo #16: on a 390px phone the category group — eight buttons — pushed the
 * document to 511px, so the whole Trips page sat partly off-canvas and the last
 * category was unreachable. The row around these groups wraps, but a group
 * cannot break itself apart: it is one bordered pill, and wrapping mid-control
 * looks broken.
 *
 * So the group takes the width it is given and scrolls its own overflow, and
 * the buttons refuse to shrink — a squashed "Familie" is not better than a
 * scrollable one.
 */
function FilterGroup({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="flex gap-1 rounded-lg p-1 max-w-full overflow-x-auto"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {children}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-md text-xs transition-colors shrink-0 whitespace-nowrap"
      style={{
        background: active ? "var(--bg-muted)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import ConfirmModal from "../components/ui/ConfirmModal";
import { useTranslation } from "../hooks/useTranslation";
import { tourIndexApi, type TourSummary } from "../lib/api/tourIndex";
import { toursApi } from "../lib/api/tours";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { sectionExpenseCount } from "../lib/sectionExpenses";
import { useToastStore } from "../store/toastStore";
import KindReviewNotice from "../components/Roadtrips/KindReviewNotice";
import StravaImportDialog, { useStravaConnected } from "../components/Trips/StravaImportDialog";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import TourTripDialog from "../components/Tours/TourTripDialog";
import { moveTourToTrip } from "../components/Tours/tourTripMove";
import LogbookTabs from "../components/table/LogbookTabs";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import ListFilterBar from "../components/table/ListFilterBar";
import ListEmptyState from "../components/table/ListEmptyState";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { SkeletonTable } from "../components/SkeletonLoader";
import { Table, type TableColumn } from "../components/ui/Table";
import { useTableHints } from "../components/ui/useTableHints";
import NewTourDialog from "../components/Tours/NewTourDialog";
import {
  TOUR_COLUMN_IDS,
  TOUR_COLUMN_LAYOUT,
  TourTableRow,
} from "../components/Tours/TourTableRow";
import { tourSummaryFigures } from "../lib/tour/tourSummaryFigures";

/**
 * Every tour the reader owns, across every trip and none.
 *
 * A tour used to exist only inside a trip: the only list was the trip
 * page's "Touren" tab, and the only way to make one was to open a trip
 * first. Owner ruling, 2026-09-21 — "Sie können auch einzeln leben" — so
 * this page is the home of the ones that belong to no trip, and shows the
 * others alongside them rather than splitting the reader's tours across
 * two places they have to remember.
 *
 * Three visually distinct states, the same discipline `TourSectionList`
 * keeps and for the same reason: a failed load must never render an empty
 * list, because "nothing yet" and "we could not ask" look identical and
 * the reader cannot tell which they are looking at.
 */
export default function ToursPage(): JSX.Element {
  const { t } = useTranslation(["trips", "roadtrips", "common"]);
  const tableHints = useTableHints();
  const addToast = useToastStore((s) => s.addToast);

  const [tours, setTours] = useState<TourSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const [loadLog, setLoadLog] = useState<string | null>(null);
  const { isEnabled } = useEnabledDomains();
  const stravaConnected = useStravaConnected();
  const [stravaOpen, setStravaOpen] = useState(false);
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<TourSummary | null>(null);
  const [photoOptIn, setPhotoOptIn] = useState<TourSummary | null>(null);
  const [movingTour, setMovingTour] = useState<TourSummary | null>(null);
  const [costsBlock, setCostsBlock] = useState<{ tour: TourSummary; count: number } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      // Day tours only since 2.7 — the multi-day kind has its own page.
      const data = await tourIndexApi.list("tour");
      if (!mountedRef.current) return;
      setTours(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setTours(null);
      setLoadError(true);
      setLoadLog(loadFailureLog(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (tour: TourSummary, deleteExpenses = false): Promise<void> => {
    try {
      await toursApi.removeStandalone(tour.id, { deleteExpenses });
      if (!mountedRef.current) return;
      setTours((prev) => (prev ?? []).filter((r) => r.id !== tour.id));
    } catch (err) {
      if (!mountedRef.current) return;
      // Costs with no trip to take them: asked once more, never deleted unasked.
      const count = sectionExpenseCount(err);
      if (count !== null) setCostsBlock({ tour, count });
      else addToast("error", t("trips:tours.deleteError"));
    }
  };

  // Detach is one click and needs no dialog; a refusal is shown, never swallowed.
  const handleDetach = async (tour: TourSummary, detachPhotos = false): Promise<void> => {
    const result = await moveTourToTrip(tour.id, null, { detachPhotos });
    if (!mountedRef.current) return;
    if (result.ok) await load();
    else if (result.canDetachPhotos) setPhotoOptIn(tour);
    else addToast("error", t(`trips:${result.errorKey}`));
  };

  const isLoading = tours === null && !loadError;
  const hasTours = !isLoading && !loadError && tours !== null && tours.length > 0;
  const isEmpty = !isLoading && !loadError && tours !== null && tours.length === 0;
  // Name or trip name, case-insensitive — the same free-text filter every other
  // domain's list has (forgejo#403) — plus the activity select. A filter that
  // empties the list says so instead of reading as "no tours yet".
  const needle = search.trim().toLowerCase();
  const visibleTours = (tours ?? []).filter(
    (tour) =>
      (activityFilter === "all" || (tour.activity ?? "") === activityFilter) &&
      (needle === "" ||
        tour.name.toLowerCase().includes(needle) ||
        (tour.tripName ?? "").toLowerCase().includes(needle))
  );
  const hasActiveFilter = needle !== "" || activityFilter !== "all";
  const resetFilters = (): void => {
    setSearch("");
    setActivityFilter("all");
  };
  const activitiesInUse = [
    ...new Set((tours ?? []).flatMap((tour) => (tour.activity ? [tour.activity] : []))),
  ];

  const columns: TableColumn[] = TOUR_COLUMN_IDS.map((id) => ({
    key: id,
    ...TOUR_COLUMN_LAYOUT[id],
    label: id === "actions" ? "" : t(`trips:tours.columns.${id}`),
  }));

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="t-screen-title">{t("trips:tours.pageTitle")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {stravaConnected && (
            <button
              type="button"
              className="rounded-md border border-(--color-border) px-3 py-2 text-sm whitespace-nowrap hover:bg-(--bg-surface)"
              onClick={() => setStravaOpen(true)}
            >
              {t("roadtrips:strava.importButton")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            <span>+</span>
            <span>{t("trips:tours.newTour")}</span>
          </button>
        </div>
      </div>
      {stravaOpen && (
        <StravaImportDialog
          target={{ kind: "newTour" }}
          onClose={() => setStravaOpen(false)}
          onDone={(routeId) => navigate(`/tours/${routeId}`)}
        />
      )}

      <ListSummaryStrip
        figures={tourSummaryFigures(visibleTours, {
          tours: (count: number) => t("trips:tours.summary.tours", { count }),
          trips: (count: number) => t("trips:tours.summary.trips", { count }),
          withoutTrip: (count: number) => t("trips:tours.summary.withoutTrip", { count }),
        })}
        filtered={hasActiveFilter}
        filteredLabel={t("common:filters.filtered")}
        unknown={isLoading || loadError || tours === null}
      />

      {/* The rule's classification of the pre-2.7 sections, shown where a
          misfiled row is found — only while the roadtrip page exists to
          move it to. */}
      {isEnabled("roadtrip") && <KindReviewNotice onChanged={() => void load()} />}

      {hasTours && (
        <ListFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("trips:tours.searchPlaceholder"),
          }}
          status={
            activitiesInUse.length > 1
              ? {
                  label: t("roadtrips:activityLabel"),
                  value: activityFilter,
                  onChange: setActivityFilter,
                  allLabel: t("trips:tours.allActivities"),
                  options: activitiesInUse.map((a) => ({
                    value: a,
                    label: t(`roadtrips:activity.${a}`),
                  })),
                }
              : undefined
          }
          hasActiveFilter={hasActiveFilter}
          onReset={resetFilters}
          resultLabel={t("common:filters.matching", { count: visibleTours.length })}
        />
      )}

      {isLoading && <SkeletonTable rows={6} />}

      {loadError && (
        <ListLoadFailed
          title={t("trips:tours.loadError")}
          onRetry={() => void load()}
          log={loadLog}
        />
      )}

      {(isEmpty || (hasTours && visibleTours.length === 0)) && (
        <div
          className="overflow-hidden rounded-lg shadow-xs"
          style={{ border: "1px solid var(--color-border)" }}
        >
          <ListEmptyState
            filtered={hasActiveFilter}
            emptyTitle={t("trips:tours.pageEmpty")}
            emptyHint={t("trips:tours.emptyHint")}
            onReset={resetFilters}
            action={{ label: t("trips:tours.newTour"), onClick: () => setCreating(true) }}
          />
        </div>
      )}

      {hasTours && visibleTours.length > 0 && (
        <Table columns={columns} label={t("trips:tours.pageTitle")} {...tableHints}>
          {visibleTours.map((tour) => (
            <TourTableRow
              key={tour.id}
              tour={tour}
              columns={columns}
              onOpen={() =>
                navigate(
                  tour.tripId === null
                    ? `/tours/${tour.id}`
                    : `/trips/${tour.tripId}/route/${tour.id}`
                )
              }
              actions={
                <RowActions>
                  {tour.tripId === null ? (
                    <RowActionButton
                      icon="link"
                      label={t("trips:tours.move.action")}
                      onClick={() => setMovingTour(tour)}
                      testId={`tour-assign-${tour.id}`}
                    />
                  ) : (
                    <RowActionButton
                      icon="unlink"
                      label={t("trips:tours.move.detach")}
                      onClick={() => void handleDetach(tour)}
                      testId={`tour-detach-${tour.id}`}
                    />
                  )}
                  <RowActionButton
                    icon="delete"
                    label={t("trips:tours.deleteLabel")}
                    onClick={() => setPendingDelete(tour)}
                    testId={`tour-delete-${tour.id}`}
                  />
                </RowActions>
              }
            />
          ))}
        </Table>
      )}

      <NewTourDialog
        open={creating}
        onClose={() => setCreating(false)}
        // Re-read rather than append: the list is ordered by the owning
        // trip's start date, and a new trip-less tour's place in that order
        // is the server's answer, not something to guess locally.
        onCreated={() => {
          setCreating(false);
          void load();
        }}
        onReload={() => void load()}
      />

      {movingTour && (
        <TourTripDialog
          tour={movingTour}
          onClose={() => setMovingTour(null)}
          onMoved={() => {
            setMovingTour(null);
            void load();
          }}
        />
      )}

      {photoOptIn && (
        <ConfirmModal
          isOpen
          onClose={() => setPhotoOptIn(null)}
          onConfirm={() => {
            const tour = photoOptIn;
            setPhotoOptIn(null);
            void handleDetach(tour, true);
          }}
          title={t("trips:tours.move.photosTitle")}
          message={t("trips:tours.move.photosError")}
          confirmText={t("trips:tours.move.detachPhotosConfirm")}
        />
      )}

      {costsBlock && (
        <ConfirmModal
          isOpen
          onClose={() => setCostsBlock(null)}
          onConfirm={() => {
            const { tour } = costsBlock;
            setCostsBlock(null);
            void handleDelete(tour, true);
          }}
          title={t("trips:tours.deleteWithCosts.title")}
          message={t("trips:tours.deleteWithCosts.message", {
            name: costsBlock.tour.name,
            count: costsBlock.count,
          })}
          confirmText={t("trips:tours.deleteWithCosts.confirm")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          isOpen
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            const tour = pendingDelete;
            setPendingDelete(null);
            void handleDelete(tour);
          }}
          title={t("trips:tours.deleteConfirm.title")}
          message={t("trips:tours.deleteConfirm.message", {
            name: pendingDelete.name,
            count: pendingDelete.stopCount,
          })}
          confirmText={t("trips:tours.deleteConfirm.confirm")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </AppShell>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useTranslation } from "../hooks/useTranslation";
import { tourIndexApi, type TourSummary } from "../lib/api/tourIndex";
import { toursApi } from "../lib/api/tours";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { useToastStore } from "../store/toastStore";
import { SELECTABLE_LEG_MODES, type LegMode } from "../types/tour";

const DEFAULT_MODE: LegMode = "road";

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

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
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [tours, setTours] = useState<TourSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<LegMode>(DEFAULT_MODE);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TourSummary | null>(null);

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
      const data = await tourIndexApi.list();
      if (!mountedRef.current) return;
      setTours(data);
    } catch {
      if (!mountedRef.current) return;
      setTours(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await toursApi.createStandalone({ name, mode: newMode });
      if (!mountedRef.current) return;
      // Re-read rather than append: the list is ordered by the owning
      // trip's start date, and a new trip-less tour's place in that order
      // is the server's answer, not something to guess locally.
      await load();
      setNewName("");
      setNewMode(DEFAULT_MODE);
      setCreating(false);
    } catch {
      if (mountedRef.current) addToast("error", t("trips:tours.createError"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleDelete = async (tour: TourSummary): Promise<void> => {
    try {
      await toursApi.removeStandalone(tour.id);
      if (!mountedRef.current) return;
      setTours((prev) => (prev ?? []).filter((r) => r.id !== tour.id));
    } catch {
      if (mountedRef.current) addToast("error", t("trips:tours.deleteError"));
    }
  };

  const isLoading = tours === null && !loadError;
  const isEmpty = !isLoading && !loadError && tours !== null && tours.length === 0;
  const hasTours = !isLoading && !loadError && tours !== null && tours.length > 0;

  return (
    <AppShell width="list">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="t-screen-title">{t("trips:tours.pageTitle")}</h1>
        <button
          type="button"
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--bg-surface)"
          onClick={() => setCreating((v) => !v)}
        >
          {t("trips:tours.newTour")}
        </button>
      </header>

      {creating && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("trips:tours.namePlaceholder")}
            aria-label={t("trips:tours.namePlaceholder")}
            className="min-w-48 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as LegMode)}
            aria-label={t("trips:tours.modeLabel")}
            className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          >
            {SELECTABLE_LEG_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`trips:tours.mode.${mode}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving || !newName.trim()}
            className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => void handleCreate()}
          >
            {t("trips:tours.save")}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="py-10 text-center text-sm text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-(--color-border) bg-(--bg-surface) p-4 text-sm">
          <p style={{ color: "var(--danger)" }}>{t("trips:tours.loadError")}</p>
          <button type="button" className="mt-2 underline" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="py-10 text-center text-sm text-(--text-muted)">
          {t("trips:tours.pageEmpty")}
        </div>
      )}

      {hasTours && (
        <ul className="space-y-2">
          {(tours ?? []).map((tour) => (
            <li
              key={tour.id}
              className="flex items-center gap-2 rounded-lg border border-(--color-border) pr-3 text-sm hover:bg-(--bg-surface)"
            >
              {/* The delete button sits OUTSIDE the link: nested in an `<a>`
                  it is not a second action, it is a click the link eats. */}
              <Link
                to={
                  tour.tripId === null
                    ? `/tours/${tour.id}`
                    : `/trips/${tour.tripId}/route/${tour.id}`
                }
                className="flex flex-1 items-center justify-between gap-3 p-3"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{tour.name}</span>
                  <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
                    {t(`trips:tours.mode.${tour.mode}`)}
                  </span>
                  {/* A tour with no trip says so, rather than showing a blank
                      where every other row shows a name. */}
                  <span className="text-xs text-(--text-muted)">
                    {tour.tripName ?? t("trips:tours.noTrip")}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-(--text-muted)">
                  <span>{t("trips:tours.stopCount", { count: tour.stopCount })}</span>
                  <span>{formatKm(tour.distanceKm)} km</span>
                </span>
              </Link>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setPendingDelete(tour)}
              >
                {t("trips:tours.deleteLabel")}
              </button>
            </li>
          ))}
        </ul>
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

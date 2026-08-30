import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { useToastStore } from "../../store/toastStore";
import { LEG_MODES, type LegMode, type TourRoute } from "../../types/tour";

interface Props {
  tripId: string;
}

const DEFAULT_MODE: LegMode = "road";

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/**
 * "Touren" tab: one row per tour route section on this trip, each linking to
 * its editor (`/trips/:id/route/:routeId`, wired up in a later task).
 *
 * Three visually distinct states — loading, empty, error — on purpose: a
 * failed load must never render "0 km" or an empty list, because either
 * looks identical to "this trip genuinely has no sections yet" and the user
 * has no way to tell a real zero from a swallowed error.
 */
export default function TourSectionList({ tripId }: Props): JSX.Element {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  // `null` = not loaded yet (or the last load failed) — distinct from `[]`,
  // which means the load succeeded and genuinely found no sections.
  const [routes, setRoutes] = useState<TourRoute[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState<LegMode>(DEFAULT_MODE);
  const [saving, setSaving] = useState(false);

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
      const data = await toursApi.list(tripId);
      if (!mountedRef.current) return;
      setRoutes(data);
    } catch {
      if (!mountedRef.current) return;
      setRoutes(null);
      setLoadError(true);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const route = await toursApi.create(tripId, { name, mode: newMode });
      if (!mountedRef.current) return;
      setRoutes((prev) => [...(prev ?? []), route]);
      // A create can succeed even after the initial list() failed (the user
      // created a section anyway while the error banner was showing) — clear
      // the stale error together with the new data, never in `finally` (a
      // FAILED create must leave an existing error banner in place, not wipe
      // it and render an empty list as if nothing were wrong).
      setLoadError(false);
      setNewName("");
      setNewMode(DEFAULT_MODE);
      setCreating(false);
    } catch {
      if (mountedRef.current) addToast("error", t("trips:tours.createError"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const isLoading = routes === null && !loadError;
  const isEmpty = !isLoading && !loadError && routes !== null && routes.length === 0;
  const hasRoutes = !isLoading && !loadError && routes !== null && routes.length > 0;

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("trips:tours.title")}</h2>
        <button
          type="button"
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--bg-surface)"
          onClick={() => setCreating((v) => !v)}
        >
          {t("trips:tours.newSection")}
        </button>
      </header>

      {creating && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("trips:tours.namePlaceholder")}
            className="min-w-48 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as LegMode)}
            className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          >
            {LEG_MODES.map((mode) => (
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
          <p className="text-rose-400">{t("trips:tours.loadError")}</p>
          <button type="button" className="mt-2 underline" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="py-10 text-center text-sm text-(--text-muted)">
          {t("trips:tours.empty")}
        </div>
      )}

      {hasRoutes && (
        <ul className="space-y-2">
          {(routes ?? []).map((route) => (
            <li key={route.id}>
              <Link
                to={`/trips/${tripId}/route/${route.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-(--color-border) p-3 text-sm hover:bg-(--bg-surface)"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{route.name}</span>
                  <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
                    {t(`trips:tours.mode.${route.mode}`)}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-(--text-muted)">
                  <span>{t("trips:tours.stopCount", { count: route.stopCount })}</span>
                  <span>{formatKm(route.distanceKm)} km</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import KindReviewNotice from "../components/Roadtrips/KindReviewNotice";
import { useTranslation } from "../hooks/useTranslation";
import { roadtripsApi } from "../lib/api/roadtrips";
import { useDisplayFormat } from "../lib/displayFormat";
import { useToastStore } from "../store/toastStore";
import { ROADTRIP_VEHICLES, type RoadtripVehicle } from "../shared/tour/roadtrip";
import type { RoadtripSummary } from "../types/roadtrip";

/**
 * Every roadtrip the reader owns (2.7, design 2026-09-24).
 *
 * The same three states the tour list keeps apart — loading, failed, empty —
 * and for the same reason: "nothing yet" and "we could not ask" look
 * identical as an empty list, and the reader cannot tell which they are
 * looking at.
 */
export default function RoadtripsPage(): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  const [rows, setRows] = useState<RoadtripSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState<RoadtripVehicle | "">("");
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
      const data = await roadtripsApi.list();
      if (mountedRef.current) setRows(data);
    } catch {
      if (!mountedRef.current) return;
      setRows(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await roadtripsApi.create({
        name: name.trim(),
        vehicle: vehicle === "" ? null : vehicle,
      });
      // Straight to the new roadtrip: an empty one has nothing to show in a
      // list, and its first stations are the next thing anyone does.
      navigate(`/roadtrips/${created.id}`);
    } catch {
      if (mountedRef.current) addToast("error", t("roadtrips:createError"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const span = (r: RoadtripSummary): string => {
    if (!r.startDate) return t("roadtrips:undated");
    const from = display.date(r.startDate, { timeZone: "UTC" });
    if (!r.endDate || r.endDate === r.startDate) return from;
    return `${from} – ${display.date(r.endDate, { timeZone: "UTC" })}`;
  };

  const isLoading = rows === null && !loadError;

  return (
    <AppShell width="list">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="t-screen-title">{t("roadtrips:pageTitle")}</h1>
        <button
          type="button"
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--bg-surface)"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
        >
          {t("roadtrips:newRoadtrip")}
        </button>
      </header>

      <KindReviewNotice onChanged={() => void load()} />

      {creating && (
        <form
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <input
            id="roadtrip-new-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("roadtrips:namePlaceholder")}
            aria-label={t("roadtrips:namePlaceholder")}
            className="min-w-48 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          />
          <select
            id="roadtrip-new-vehicle"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value as RoadtripVehicle | "")}
            aria-label={t("roadtrips:vehicleLabel")}
            className="rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
          >
            <option value="">{t("roadtrips:vehicleNone")}</option>
            {ROADTRIP_VEHICLES.map((v) => (
              <option key={v} value={v}>
                {t(`roadtrips:vehicle.${v}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-(--bg-base) disabled:opacity-40"
          >
            {t("roadtrips:create")}
          </button>
        </form>
      )}

      {isLoading && (
        <div className="py-10 text-center text-sm text-(--text-muted)">
          {t("common:loading.default")}
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-(--color-border) bg-(--bg-surface) p-4 text-sm">
          <p style={{ color: "var(--danger)" }}>{t("roadtrips:loadError")}</p>
          <button type="button" className="mt-2 underline" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="py-10 text-center text-sm text-(--text-muted)">{t("roadtrips:empty")}</div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to={`/roadtrips/${r.id}`}
                className="block rounded-lg border border-(--color-border) p-3 text-sm hover:bg-(--bg-surface)"
                style={{ borderLeft: "3px solid var(--domain-roadtrip)" }}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-(--text-muted)">{span(r)}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-(--text-muted)">
                  {r.vehicle && <span>{t(`roadtrips:vehicle.${r.vehicle}`)}</span>}
                  <span className="t-meta-mono">{nf.format(r.distanceKm)} km</span>
                  <span>
                    {t("roadtrips:nightsCount", { count: r.nights })}
                    {!r.nightsKnown && " *"}
                  </span>
                  <span>{t("roadtrips:stationCount", { count: r.stationCount })}</span>
                  {r.countries.length > 0 && (
                    <span className="t-meta-mono">{r.countries.join(" · ")}</span>
                  )}
                  {r.tourCount > 0 && (
                    <span>{t("roadtrips:tourCount", { count: r.tourCount })}</span>
                  )}
                  {r.tripName && <span>{t("roadtrips:inTrip", { name: r.tripName })}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

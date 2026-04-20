import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise } from "../types";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { CruiseRouteMap } from "../components/Cruise/CruiseRouteMap";
import TripTimeline, { type TimelineEvent } from "../components/Trip/TripTimeline";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
};

export default function CruiseDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("cruise");
  const [cruise, setCruise] = useState<Cruise | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const c = await cruiseApi.get(id);
        if (!cancelled) setCruise(c);
      } catch {
        if (!cancelled) setError("Cruise not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="p-6 text-[var(--text-muted)]">Loading …</div>
      </div>
    );
  }
  if (error !== null || !cruise) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-3xl p-6">
          <button
            onClick={() => navigate("/cruises")}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            ← {t("list.title")}
          </button>
          <div className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {error ?? "Cruise not found"}
          </div>
        </div>
      </div>
    );
  }

  const events: TimelineEvent[] = cruise.stops.map((stop) => ({
    id: stop.id,
    domain: "cruise",
    date: stop.arrivalTime ?? cruise.startDate ?? new Date().toISOString(),
    title: stop.isAtSea ? t("stops.at_sea") : (stop.port?.name ?? "—"),
    subtitle: stop.isAtSea
      ? undefined
      : [stop.port?.city, stop.port?.country].filter(Boolean).join(", ") || undefined,
    meta: stop.excursionNote ?? undefined,
  }));

  const portsCount = cruise.stops.filter((s) => !s.isAtSea).length;
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <button
          onClick={() => navigate("/cruises")}
          className="mb-3 text-sm text-[var(--accent)] hover:underline"
        >
          ← {t("list.title")}
        </button>

        {/* Ship-header strip */}
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--bg-surface)] p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl"
              style={{ backgroundColor: "#38bdf822", color: "#38bdf8" }}
            >
              🚢
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                {cruise.ship?.name ?? cruise.shipNameOverride ?? "—"}
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                {cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-2 py-1">
              {fmtDate(cruise.startDate)} – {fmtDate(cruise.endDate)}
            </span>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-2 py-1">
              {portsCount} {t("field.ports")}
            </span>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-2 py-1">
              {seaDays} {t("field.sea_days")}
            </span>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-2 py-1">
              {t(`status.${cruise.status}`)}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">
              {t("detail.route")}
            </h2>
            {events.length > 0 ? (
              <TripTimeline events={events} />
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                {t("stops.title")}
              </div>
            )}
          </div>

          <aside className="space-y-3 md:col-span-2">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
              <p className="mb-2 text-xs uppercase text-[var(--text-muted)]">{t("detail.route")}</p>
              <CruiseRouteMap cruise={cruise} />
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("detail.cabin")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <dt>{t("field.cabin")}</dt>
                  <dd>{cruise.cabinNumber ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("field.cabinType")}</dt>
                  <dd>{cruise.cabinType ? t(`cabinType.${cruise.cabinType}`) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("field.deck")}</dt>
                  <dd>{cruise.deck ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("detail.costs")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <dt>{t("field.bookingReference")}</dt>
                  <dd>{cruise.bookingReference ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("field.price")}</dt>
                  <dd>
                    {cruise.price !== null
                      ? `${cruise.price.toFixed(2)} ${cruise.currency ?? ""}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("detail.meta")}
              </h3>
              {cruise.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {cruise.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {cruise.companions.length > 0 && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  <span className="text-[var(--text-muted)]">{t("field.companions")}:</span>{" "}
                  {cruise.companions.join(", ")}
                </p>
              )}
              {cruise.notes !== null && cruise.notes.length > 0 && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
                  {cruise.notes}
                </p>
              )}
            </div>
          </aside>
        </div>

        {editing && (
          <CruiseEditModal
            mode="edit"
            cruise={cruise}
            onClose={() => setEditing(false)}
            onSaved={(updated) => {
              setCruise(updated);
              setEditing(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

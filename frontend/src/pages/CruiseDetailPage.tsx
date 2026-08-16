import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise } from "../types";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { CruiseRouteMap } from "../components/Cruise/CruiseRouteMap";
import {
  buildEffectiveTimeline,
  countUniquePorts,
  countUnresolvedPorts,
} from "../components/Cruise/cruisePorts";
import { cruiseStatusPillStyle } from "../components/Cruise/cruiseStatusStyle";
import TripTimeline, { type TimelineEvent } from "../components/Trip/TripTimeline";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";
import { formatDateInTimezone } from "../lib/dateUtils";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return formatDateInTimezone(iso, "UTC");
};

export default function CruiseDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("cruise");
  const [cruise, setCruise] = useState<Cruise | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    setDeleting(true);
    try {
      await cruiseApi.remove(id);
      addToast("success", t("detail.deleteSuccess"));
      navigate("/cruises");
    } catch (err: unknown) {
      logger.error("CruiseDetailPage: delete failed", err);
      addToast("error", t("detail.deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const c = await cruiseApi.get(id);
        if (!cancelled) setCruise(c);
      } catch {
        if (!cancelled) setNotFound(true);
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
        <div className="p-6 text-(--text-muted)">{t("detail.loading")}</div>
      </div>
    );
  }
  if (notFound || !cruise) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-3xl p-6">
          <button
            onClick={() => navigate("/cruises")}
            className="text-sm text-(--accent) hover:underline"
          >
            ← {t("list.title")}
          </button>
          <div className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)">
            {t("detail.notFound")}
          </div>
        </div>
      </div>
    );
  }

  // Effective itinerary includes departure/arrival ports so the route list
  // never reads emptier than the list page's port count for the same cruise.
  const events: TimelineEvent[] = buildEffectiveTimeline(cruise).map((entry) => ({
    id: entry.key,
    domain: "cruise",
    date: entry.date ?? cruise.startDate ?? new Date().toISOString(),
    title: entry.isAtSea
      ? t("stops.at_sea")
      : entry.port?.name ?? (entry.unresolvedPortName ? `🔶 ${entry.unresolvedPortName}` : "—"),
    subtitle: entry.isAtSea
      ? undefined
      : entry.port
        ? [entry.port.city, entry.port.country].filter(Boolean).join(", ") || undefined
        : entry.unresolvedPortName
          ? t("stops.unresolved")
          : undefined,
    meta: entry.excursionNote ?? undefined,
  }));

  const portsCount = countUniquePorts(cruise);
  const unresolvedCount = countUnresolvedPorts(cruise);
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <button
          onClick={() => navigate("/cruises")}
          className="mb-3 text-sm text-(--accent) hover:underline"
        >
          ← {t("list.title")}
        </button>

        {/* Ship-header strip */}
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-(--bg-surface) p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl"
              style={{
                backgroundColor: "var(--domain-cruise-soft)",
                color: "var(--domain-cruise)",
              }}
            >
              🚢
            </div>
            <div>
              <h1 className="text-xl font-semibold text-(--text-primary)">
                {cruise.ship?.name ?? cruise.shipNameOverride ?? "—"}
              </h1>
              <p className="text-sm text-(--text-muted)">
                {cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—"}
              </p>
              {cruise.routeName && (
                <p className="text-sm font-medium text-(--text-primary)">{cruise.routeName}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-(--text-muted)">
            <span className="rounded-md border border-border bg-(--bg-base) px-2 py-1">
              {fmtDate(cruise.startDate)} – {fmtDate(cruise.endDate)}
            </span>
            <span className="rounded-md border border-border bg-(--bg-base) px-2 py-1">
              {portsCount} {t("field.ports", { count: portsCount })}
              {unresolvedCount > 0 && (
                <span
                  className="ml-1 text-xs"
                  title={t("list.unresolvedPorts", { count: unresolvedCount })}
                >
                  (+{unresolvedCount})
                </span>
              )}
            </span>
            <span className="rounded-md border border-border bg-(--bg-base) px-2 py-1">
              {seaDays} {t("field.sea_days", { count: seaDays })}
            </span>
            <span
              className="rounded-full px-2 py-1 font-semibold"
              style={cruiseStatusPillStyle(cruise.status)}
            >
              {t(`status.${cruise.status}`)}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md bg-(--accent) px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-(--accent-dim)"
            >
              {t("detail.edit")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md border border-(--danger)/50 px-3 py-1 text-sm font-medium text-(--danger) hover:bg-(--danger)/10"
            >
              {t("detail.delete")}
            </button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <h2 className="mb-2 text-sm font-semibold text-(--text-muted)">
              {t("detail.route")}
            </h2>
            {events.length > 0 ? (
              <TripTimeline events={events} />
            ) : (
              <div className="rounded-md border border-border bg-(--bg-surface) px-4 py-6 text-center text-sm text-(--text-muted)">
                {t("detail.stopsEmpty")}
              </div>
            )}
          </div>

          <aside className="space-y-3 md:col-span-2">
            <div className="rounded-md border border-border bg-(--bg-surface) p-3">
              <p className="mb-2 text-xs uppercase text-(--text-muted)">{t("detail.route")}</p>
              <CruiseRouteMap cruise={cruise} />
            </div>

            <div className="rounded-md border border-border bg-(--bg-surface) p-4">
              <h3 className="text-sm font-semibold text-(--text-primary)">
                {t("detail.cabin")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-(--text-muted)">
                <div className="flex justify-between">
                  <dt>{t("field.cabin")}</dt>
                  <dd>{cruise.cabinNumber ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("field.cabinType")}</dt>
                  <dd>
                    {cruise.cabinType
                      ? t(`cabinType.${cruise.cabinType}`, { defaultValue: cruise.cabinType })
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("field.deck")}</dt>
                  <dd>{cruise.deck ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-md border border-border bg-(--bg-surface) p-4">
              <h3 className="text-sm font-semibold text-(--text-primary)">
                {t("detail.costs")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-(--text-muted)">
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

            <div className="rounded-md border border-border bg-(--bg-surface) p-4">
              <h3 className="text-sm font-semibold text-(--text-primary)">
                {t("detail.meta")}
              </h3>
              {cruise.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {cruise.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-border px-2 py-0.5 text-xs text-(--text-muted)"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {cruise.companions.length > 0 && (
                <p className="mt-2 text-xs text-(--text-muted)">
                  <span className="text-(--text-muted)">{t("field.companions")}:</span>{" "}
                  {cruise.companions.join(", ")}
                </p>
              )}
              {cruise.notes !== null && cruise.notes.length > 0 && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-(--text-muted)">
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

        {confirmingDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-lg border border-border bg-(--bg-elevated) p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-(--text-primary)">
                {t("detail.deleteConfirmTitle")}
              </h3>
              <p className="mt-2 text-sm text-(--text-muted)">
                {t("detail.deleteConfirmMessage")}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
                >
                  {t("detail.deleteCancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="rounded-md bg-(--danger) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t("detail.deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

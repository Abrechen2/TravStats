import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise } from "../types";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { CruiseRouteMap } from "../components/Cruise/CruiseRouteMap";
import {
  buildEffectiveTimeline,
  countPortCalls,
  countUniquePorts,
  countUnresolvedPorts,
} from "../components/Cruise/cruisePorts";
import { cruiseStatusPillStyle } from "../components/Cruise/cruiseStatusStyle";
import TripTimeline, { type TimelineEvent } from "../components/Trip/TripTimeline";
import TripPill from "../components/Trips/TripPill";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import Button from "../components/ui/Button";
import { useTranslation } from "../hooks/useTranslation";
import { formatDateInTimezone } from "../lib/dateUtils";
import { formatAmount } from "../lib/units";
import { useToastStore } from "../store/toastStore";
import ConfirmModal from "../components/Training/ConfirmModal";
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { logger } from "../lib/logger";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return formatDateInTimezone(iso, "UTC");
};

export default function CruiseDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("cruise");
  const [cruise, setCruise] = useState<Cruise | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // Two states, not one: a 404 means the cruise is gone, anything else
  // means we could not ask. The page used to answer "nicht gefunden" to
  // both, denying a record that a dropped connection had merely hidden.
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  /** Bumped by the retry button; the fetch effect watches it. */
  const [reloadKey, setReloadKey] = useState<number>(0);
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
      setFailure(null);
      try {
        const c = await cruiseApi.get(id);
        if (!cancelled) setCruise(c);
      } catch (err: unknown) {
        logger.error("CruiseDetailPage: failed to load cruise", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !cruise) {
    // A load error is a state you get out of, so it offers the retry that
    // "not found" must not pretend to have.
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <div>
          <Link to="/cruises" className="ts-back-link text-sm text-(--text-muted)">
            ← {t("list.title")}
          </Link>
          <div
            role="alert"
            className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
          >
            {isLoadError ? t("detail.loadError") : t("detail.notFound")}
          </div>
          {isLoadError && (
            <div className="mt-3">
              <Button onClick={() => setReloadKey((k) => k + 1)}>
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
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
      : (entry.port?.name ?? (entry.unresolvedPortName ? `🔶 ${entry.unresolvedPortName}` : "—")),
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
    <AppShell width="list">
      <DetailHeader
        backTo="/cruises"
        backLabel={t("list.title")}
        domain="cruise"
        icon="🚢"
        title={cruise.ship?.name ?? cruise.shipNameOverride ?? "—"}
        subtitle={
          <>
            <span>{cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—"}</span>
            {cruise.routeName && (
              <span style={{ color: "var(--ts-text)" }}>{cruise.routeName}</span>
            )}
            {cruise.trip && (
              <span data-testid="cruise-detail-trip">
                <TripPill trip={cruise.trip} />
              </span>
            )}
          </>
        }
        facts={[
          `${fmtDate(cruise.startDate)} – ${fmtDate(cruise.endDate)}`,
          <>
            {portsCount} {t("field.ports", { count: portsCount })}
            {unresolvedCount > 0 && (
              <span
                className="ml-1"
                title={t("list.unresolvedPorts", { count: unresolvedCount })}
                aria-label={t("list.unresolvedPorts", { count: unresolvedCount })}
              >
                (+{unresolvedCount})
              </span>
            )}
          </>,
          `${seaDays} ${t("field.sea_days", { count: seaDays })}`,
        ]}
        status={
          <span className="ts-status-pill" style={cruiseStatusPillStyle(cruise.status)}>
            {t(`status.${cruise.status}`)}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("detail.edit")}</Button>
            <Button onClick={() => setConfirmingDelete(true)}>{t("detail.delete")}</Button>
          </>
        }
      />

      {/* Two-column body */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="md:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-(--text-muted)">{t("detail.route")}</h2>
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
            <h3 className="text-sm font-semibold text-(--text-primary)">{t("detail.cabin")}</h3>
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
            <h3 className="text-sm font-semibold text-(--text-primary)">{t("detail.costs")}</h3>
            <dl className="mt-2 space-y-1 text-xs text-(--text-muted)">
              <div className="flex justify-between">
                <dt>{t("field.bookingReference")}</dt>
                <dd>{cruise.bookingReference ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t("field.price")}</dt>
                <dd>
                  {cruise.price !== null
                    ? formatAmount(cruise.price, cruise.currency, { language: i18n.language })
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-border bg-(--bg-surface) p-4">
            <h3 className="text-sm font-semibold text-(--text-primary)">{t("detail.meta")}</h3>
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
              <p className="mt-2 whitespace-pre-wrap text-xs text-(--text-muted)">{cruise.notes}</p>
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

      {/* Same component, same keys and same sentence as the cruise LIST.
            The two used to disagree: the list named the ship without warning
            that it was permanent, this one warned without naming the ship,
            and neither mentioned the port calls that go with it. */}
      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("detail.deleteConfirmTitle")}
        message={countedDeleteMessage(
          t,
          {
            counted: "cruise:detail.deleteConfirmMessage",
            empty: "cruise:detail.deleteConfirmMessageNoStops",
          },
          cruise.ship?.name ?? cruise.shipNameOverride ?? t("list.unnamedShip"),
          countPortCalls(cruise)
        )}
        confirmText={t("detail.deleteConfirm")}
        cancelText={t("detail.deleteCancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}

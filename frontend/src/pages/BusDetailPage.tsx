import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailKpis, { type DetailKpi } from "../components/ui/DetailKpis";
import DetailSection from "../components/ui/DetailSection";
import PeopleList from "../components/ui/PeopleList";
import Button from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import TripPill from "../components/Trips/TripPill";
import ConfirmModal from "../components/Training/ConfirmModal";
import DocumentsSection from "../components/documents/DocumentsSection";
import { BusFormModal } from "../components/bus/BusFormModal";
import { BusNoRoutingNote } from "../components/bus/BusNoRoutingNote";
import { BusRouteMap } from "../components/bus/BusRouteMap";
import TripPhotoWindowStrip from "../components/common/TripPhotoWindowStrip";
import { useBusRouting } from "../hooks/useBusRouting";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { busApi } from "../lib/api/bus";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { busDeleteMessage } from "../lib/bus/busDeleteMessage";
import { distanceSourceKey, fallbackReasonKey } from "../lib/bus/busRoutingWords";
import { apiErrorMachineCode } from "../lib/apiError";
import { formatAmount, dateLocaleForLanguage } from "../lib/units";
import { formatStationTime, railDurationMinutes } from "../lib/railTime";
import { railArrival, railDeparture } from "../lib/entityTimes";
import { formatRailDuration } from "../lib/rail/railDuration";
import { logger } from "../lib/logger";
import { EDIT_PARAM, useEditDeepLink } from "../lib/editDeepLink";
import { useToastStore } from "../store/toastStore";
import type { BusJourney } from "../types/bus";
import WebGLGuard from "../components/map/WebGLGuard";

/**
 * One bus ride (spec 2026-10-07-bus-domain-design §11). Every time is on its
 * terminal's clock, a distance says what it measures, and an unrecorded delay
 * stays apart from an on-time arrival. Gated in App.tsx like the logbook, by
 * the user's domain choice.
 */
export default function BusDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // `rail` carries the duration words `formatRailDuration` reads.
  const { t, i18n } = useTranslation(["bus", "rail", "common", "trips"]);
  const locale = dateLocaleForLanguage(i18n.language);
  const addToast = useToastStore((s) => s.addToast);
  const [ride, setRide] = useState<BusJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [routingAgain, setRoutingAgain] = useState(false);
  /** What the last "route again" said, kept on the page: a failure must not vanish with a toast. */
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const routing = useBusRouting();
  const documentCount = useDocumentCount(
    confirmingDelete && ride ? { type: "busJourney", id: ride.id } : null
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const loaded = await busApi.get(id);
        if (!cancelled) setRide(loaded);
      } catch (err: unknown) {
        logger.error("BusDetailPage: failed to load ride", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // `?edit=1` — the inbox asking for a ride's zone or time (timeFlagLinks.ts).
  useEditDeepLink(EDIT_PARAM.edit, ride !== null, () => setEditing(true));

  const handleDelete = async (): Promise<void> => {
    if (!ride) return;
    setDeleting(true);
    try {
      await busApi.remove(ride.id);
      addToast("success", t("bus:deleted"));
      navigate("/bus");
    } catch (err: unknown) {
      logger.error("BusDetailPage: delete failed", err);
      addToast("error", t("bus:deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleRouteAgain = async (): Promise<void> => {
    if (!ride) return;
    setRoutingAgain(true);
    setRouteMessage(null);
    try {
      const { ride: routed, geometry } = await busApi.routeAgain(ride.id);
      setRide(routed);
      if (geometry?.outcome === "routed") {
        const km = Math.round(routed.distanceKm ?? 0).toLocaleString(locale);
        setRouteMessage(t("bus:routing.routed", { km }));
      } else if (geometry?.outcome === "straight") {
        const reason = t(fallbackReasonKey(geometry.fallback));
        setRouteMessage(t("bus:routing.stillStraight", { reason }));
      } else {
        setRouteMessage(t("bus:routing.unchanged"));
      }
    } catch (err: unknown) {
      logger.error("BusDetailPage: route again failed", err);
      const status = (err as { response?: { status?: number } }).response?.status;
      setRouteMessage(
        status === 403 || apiErrorMachineCode(err) === "DEMO_ACCOUNT_FORBIDDEN"
          ? t("bus:routing.demoRefused")
          : status === 429
            ? t("bus:routing.tooMany")
            : t("bus:routing.requestFailed")
      );
    } finally {
      setRoutingAgain(false);
    }
  };

  const handleSaved = (): void => {
    setEditing(false);
    addToast("success", t("bus:saved"));
    setReloadKey((k) => k + 1);
  };

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("bus:detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !ride) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <Link to="/bus" className="ts-back-link text-sm text-(--text-muted)">
          ← {t("bus:title")}
        </Link>
        <div
          role="alert"
          className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
        >
          {isLoadError ? t("bus:detail.loadError") : t("bus:detail.notFound")}
        </div>
        {isLoadError && (
          <div className="mt-3">
            <Button onClick={() => setReloadKey((k) => k + 1)}>{t("common:buttons.retry")}</Button>
          </div>
        )}
      </AppShell>
    );
  }

  const departure = railDeparture(ride);
  const arrival = railArrival(ride);
  const minutes = departure ? railDurationMinutes(departure, arrival) : null;
  const price =
    ride.price !== null
      ? formatAmount(ride.price, ride.currency, { language: i18n.language })
      : null;
  const delayText =
    ride.delayMinutes === null
      ? t("bus:detail.delayUnknown")
      : ride.delayMinutes > 0
        ? t("bus:delay", { minutes: ride.delayMinutes })
        : t("bus:onTime");
  // The figure says what it measures — "Luftlinie" only for the chord.
  const sourceKey = distanceSourceKey(ride.distanceSource);
  const distanceLabel = sourceKey
    ? `${t("bus:detail.distance")} · ${t(sourceKey)}`
    : t("bus:detail.distance");
  // The caption names the terminal's zone: the clock is the one on the ticket.
  const timeLabel = (key: "departure" | "arrival", zone: string | null | undefined): string =>
    zone ? `${t(`bus:detail.${key}`)} · ${zone}` : t(`bus:detail.${key}`);

  const kpis: DetailKpi[] = [
    ...(departure
      ? [
          {
            key: "departure",
            value: formatStationTime(departure, locale),
            label: timeLabel("departure", departure.zone),
          },
        ]
      : []),
    ...(arrival
      ? [
          {
            key: "arrival",
            value: formatStationTime(arrival, locale),
            label: timeLabel("arrival", arrival.zone),
          },
        ]
      : []),
    ...(minutes !== null
      ? [
          {
            key: "duration",
            value: formatRailDuration(minutes, t),
            label: t("bus:detail.duration"),
          },
        ]
      : []),
    ...(ride.distanceKm !== null
      ? [
          {
            key: "distance",
            value: `${Math.round(ride.distanceKm).toLocaleString(locale)} km`,
            label: distanceLabel,
          },
        ]
      : []),
    ...(price !== null ? [{ key: "price", value: price, label: t("bus:detail.price") }] : []),
  ];

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/bus"
        backLabel={t("bus:detail.back")}
        domain="bus"
        icon={<Icon name="bus" size={24} />}
        title={`${ride.depStationName} → ${ride.arrStationName}`}
        subtitle={[ride.operator, ride.lineName].filter(Boolean).join(" · ") || undefined}
        hero={kpis.length > 0 ? <DetailKpis items={kpis} /> : undefined}
        status={
          <span className="ts-status-pill" data-testid="bus-detail-status">
            {t(`bus:status.${ride.status}`)}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("bus:edit")}</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t("bus:delete")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection
            title={t("bus:detail.facts")}
            facts={[
              { label: t("bus:detail.line"), value: ride.lineName },
              {
                label: t("bus:detail.kind"),
                value: ride.rideKind ? t(`bus:kind.${ride.rideKind}`) : null,
              },
              { label: t("bus:detail.class"), value: ride.fareClass },
              { label: t("bus:detail.seat"), value: ride.seat, mono: true },
              { label: t("bus:detail.bookingReference"), value: ride.bookingReference, mono: true },
              { label: t("bus:detail.delay"), value: delayText },
            ]}
          />

          {(ride.geometrySource === "straight" || routeMessage !== null) && (
            <DetailSection title={t("bus:detail.routeTitle")}>
              <div className="flex flex-col items-start gap-2" data-testid="bus-route-again">
                {routing?.configured === false ? (
                  <BusNoRoutingNote />
                ) : (
                  <Button
                    onClick={() => void handleRouteAgain()}
                    disabled={routingAgain || routing === null}
                  >
                    {routingAgain ? t("bus:routing.againBusy") : t("bus:routing.again")}
                  </Button>
                )}
                {routeMessage && (
                  <p role="status" className="t-caption" data-testid="bus-route-message">
                    {routeMessage}
                  </p>
                )}
              </div>
            </DetailSection>
          )}

          <DocumentsSection entry={{ type: "busJourney", id: ride.id }} />
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          {ride.trip && (
            <DetailSection title={t("trips:tab")}>
              <span data-testid="bus-detail-trip">
                <TripPill trip={ride.trip} />
              </span>
            </DetailSection>
          )}
          {/* The trip's photos taken on board, as a train ride shows them. */}
          {ride.tripId && <TripPhotoWindowStrip entry="bus" id={ride.id} />}

          <DetailSection title={t("bus:detail.route")}>
            <WebGLGuard>
              <BusRouteMap ride={ride} />
            </WebGLGuard>
          </DetailSection>

          {ride.companions.length > 0 && (
            <DetailSection title={t("bus:detail.companions")}>
              <PeopleList names={ride.companions} />
            </DetailSection>
          )}

          {(ride.tags.length > 0 || (ride.notes !== null && ride.notes.length > 0)) && (
            <DetailSection title={t("bus:detail.notes")}>
              {ride.notes && (
                <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
                  {ride.notes}
                </p>
              )}
              {ride.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ride.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border px-2.5 py-0.5 text-xs"
                      style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </DetailSection>
          )}
        </aside>
      </div>

      {editing && (
        <BusFormModal
          journey={ride}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
          afterSaveFailedKey="common:form.savedButViewRefreshFailed"
        />
      )}

      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("bus:delete")}
        message={busDeleteMessage(t, ride, documentCount)}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}

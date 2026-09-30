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
import { railExtractTarget } from "../lib/extractTargets";
import TripPhotoWindowStrip from "../components/common/TripPhotoWindowStrip";
import { RailFormModal } from "../components/rail/RailFormModal";
import { RailRouteMap } from "../components/rail/RailRouteMap";
import { RailConnectionLegs } from "../components/rail/RailConnectionLegs";
import { trainLabel } from "../components/rail/RailJourneyRow";
import { connectionDraftFrom } from "../components/rail/railFormModel";
import { isConvertedFromRoadtrip, railDistanceNoteKey } from "../components/rail/railDistanceLabel";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { railApi } from "../lib/api/rail";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS, withDocumentNote } from "../lib/deleteConfirm";
import { formatAmount } from "../lib/units";
import { formatStationTime, railDurationMinutes } from "../lib/railTime";
import {
  railActualArrival,
  railActualDeparture,
  railArrival,
  railDeparture,
} from "../lib/entityTimes";
import { yourTimeText } from "../lib/yourTime";
import type { TimeValue } from "../shared/time";
import { useSettingsStore } from "../store/settingsStore";
import { logger } from "../lib/logger";
import { EDIT_PARAM, useEditDeepLink } from "../lib/editDeepLink";
import { useToastStore } from "../store/toastStore";
import type { RailJourney, RailJourneyDetail } from "../types/rail";
import { StationShortCode } from "../components/rail/StationShortCode";

type Editing = { mode: "edit" } | { mode: "connection" } | null;

/** "3 h 42 min" from minutes; the unit words come from the locale. */
function formatDuration(
  minutes: number,
  t: (key: string, o?: Record<string, unknown>) => string
): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t("rail:detail.durationHm", { h, m }) : t("rail:detail.durationM", { m });
}

/**
 * One train ride (spec 2026-09-25-rail-domain, phase 2b). Every time is on its
 * station's clock, a distance says what it measures, and an unrecorded delay
 * stays apart from an on-time arrival. The route is gated in App.tsx like the
 * logbook: the `railDomain` beta switch, then the user's domain choice.
 */
export default function RailDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["rail", "common", "trips", "documents"]);
  const viewerZone = useSettingsStore((s) => s.display?.timezone);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const addToast = useToastStore((s) => s.addToast);
  const [journey, setJourney] = useState<RailJourneyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const documentCount = useDocumentCount(
    confirmingDelete && journey ? { type: "railJourney", id: journey.id } : null
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const loaded = await railApi.get(id);
        if (!cancelled) setJourney(loaded);
      } catch (err: unknown) {
        logger.error("RailDetailPage: failed to load journey", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // `?edit=1` — the inbox asking for a journey's zone or time (timeFlagLinks.ts).
  useEditDeepLink(EDIT_PARAM.edit, journey !== null, () => setEditing({ mode: "edit" }));

  const handleDelete = async (): Promise<void> => {
    if (!journey) return;
    setDeleting(true);
    try {
      await railApi.remove(journey.id);
      addToast("success", t("rail:deleted"));
      navigate("/rail");
    } catch (err: unknown) {
      logger.error("RailDetailPage: delete failed", err);
      addToast("error", t("rail:deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleSaved = (saved: RailJourney): void => {
    setEditing(null);
    addToast("success", t("rail:saved"));
    // A new connection is its own page; an edit reloads this one, so the
    // booking's leg list is read again rather than patched by hand.
    if (saved.id !== journey?.id) navigate(`/rail/${saved.id}`);
    else setReloadKey((k) => k + 1);
  };

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("rail:detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !journey) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <Link to="/rail" className="ts-back-link text-sm text-(--text-muted)">
          ← {t("rail:title")}
        </Link>
        <div
          role="alert"
          className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
        >
          {isLoadError ? t("rail:detail.loadError") : t("rail:detail.notFound")}
        </div>
        {isLoadError && (
          <div className="mt-3">
            <Button onClick={() => setReloadKey((k) => k + 1)}>{t("common:buttons.retry")}</Button>
          </div>
        )}
      </AppShell>
    );
  }

  const distanceNoteKey = railDistanceNoteKey(journey.distanceSource, { includeTicket: true });
  const distanceNote = distanceNoteKey ? t(distanceNoteKey) : null;
  const departure = railDeparture(journey);
  const duration = departure ? railDurationMinutes(departure, railArrival(journey)) : null;
  const price =
    journey.price !== null
      ? formatAmount(journey.price, journey.currency, { language: i18n.language })
      : null;
  const delayText =
    journey.delayMinutes === null
      ? t("rail:detail.delayUnknown")
      : journey.delayMinutes > 0
        ? t("rail:delay", { minutes: journey.delayMinutes })
        : t("rail:onTime");

  const kpis: DetailKpi[] = [
    ...(journey.distanceKm !== null
      ? [
          {
            key: "distance",
            value: `${Math.round(journey.distanceKm).toLocaleString(locale)} km`,
            label: distanceNote ?? t("rail:detail.distance"),
          },
        ]
      : []),
    ...(duration !== null
      ? [{ key: "duration", value: formatDuration(duration, t), label: t("rail:detail.duration") }]
      : []),
    ...(journey.delayMinutes !== null
      ? [{ key: "delay", value: delayText, label: t("rail:detail.delay") }]
      : []),
  ];

  // The station's clock, its zone named, and the user's own clock as a hint (Q2).
  const stationTime = (value: TimeValue | null): string | null => {
    if (!value) return null;
    const hint = yourTimeText(value, viewerZone, t);
    const zone = value.zone ? ` (${value.zone})` : "";
    return `${formatStationTime(value, locale)}${zone}${hint ? ` · ${hint}` : ""}`;
  };

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/rail"
        backLabel={t("rail:detail.back")}
        domain="rail"
        icon={<Icon name="train-front" size={24} />}
        title={`${journey.depStationName} → ${journey.arrStationName}`}
        subtitle={
          // The DB codes, in the title's order, where the catalogue knows them;
          // a dash for an unknown one, and no line at all when neither is known.
          journey.depStationShortCode || journey.arrStationShortCode ? (
            <span data-testid="rail-detail-station-codes">
              {journey.depStationShortCode ? (
                <StationShortCode code={journey.depStationShortCode} />
              ) : (
                "–"
              )}
              {" → "}
              {journey.arrStationShortCode ? (
                <StationShortCode code={journey.arrStationShortCode} />
              ) : (
                "–"
              )}
            </span>
          ) : undefined
        }
        meta={[trainLabel(journey), departure ? formatStationTime(departure, locale) : null]
          .filter(Boolean)
          .join(" · ")}
        hero={kpis.length > 0 ? <DetailKpis items={kpis} /> : undefined}
        status={
          <span className="ts-status-pill" data-testid="rail-detail-status">
            {t(`rail:status.${journey.status}`)}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing({ mode: "edit" })}>{t("rail:edit")}</Button>
            <Button onClick={() => setEditing({ mode: "connection" })}>
              {t("rail:connection.add")}
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t("rail:delete")}
            </Button>
          </>
        }
      />

      {isConvertedFromRoadtrip(journey) && (
        <p className="t-caption mb-4" data-testid="rail-converted-note">
          {t("rail:detail.convertedFromRoadtrip")}
          {journey.arrivalTime === null && ` ${t("rail:detail.convertedPlaceholder")}`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection
            title={t("rail:detail.times")}
            facts={[
              {
                label: t("rail:detail.plannedDeparture"),
                value: stationTime(departure),
              },
              {
                label: t("rail:detail.plannedArrival"),
                value: stationTime(railArrival(journey)),
              },
              {
                label: t("rail:detail.actualDeparture"),
                value: stationTime(railActualDeparture(journey)),
              },
              {
                label: t("rail:detail.actualArrival"),
                value: stationTime(railActualArrival(journey)),
              },
              { label: t("rail:detail.delay"), value: delayText },
            ]}
          />

          <DetailSection
            title={t("rail:detail.ticket")}
            facts={[
              {
                label: t("rail:form.class"),
                value: journey.travelClass ? t(`rail:class.${journey.travelClass}`) : null,
              },
              { label: t("rail:form.coach"), value: journey.coach, mono: true },
              { label: t("rail:form.seatNumber"), value: journey.seat, mono: true },
              {
                label: t("rail:form.bookingReference"),
                value: journey.bookingReference,
                mono: true,
              },
              { label: t("rail:form.price"), value: price, mono: true },
            ]}
          />

          {journey.booking && journey.booking.railJourneys.length > 1 && (
            <DetailSection title={t("rail:connection.title")}>
              <RailConnectionLegs
                currentId={journey.id}
                legs={journey.booking.railJourneys}
                pnr={journey.booking.pnr}
              />
            </DetailSection>
          )}

          <DocumentsSection
            entry={{ type: "railJourney", id: journey.id }}
            extract={railExtractTarget(journey, async (updates) => {
              await railApi.update(journey.id, updates);
              addToast("success", t("documents:extract.applied"));
              setReloadKey((k) => k + 1);
            })}
          />
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          {journey.trip && (
            <DetailSection title={t("trips:tab")}>
              <span data-testid="rail-detail-trip">
                <TripPill trip={journey.trip} />
              </span>
            </DetailSection>
          )}
          {/* The trip's photos taken on board, as a flight shows them. */}
          {journey.tripId && <TripPhotoWindowStrip entry="rail" id={journey.id} />}

          <DetailSection title={t("rail:detail.route")}>
            <RailRouteMap journey={journey} />
          </DetailSection>

          {journey.companions.length > 0 && (
            <DetailSection title={t("rail:form.companions")}>
              <PeopleList names={journey.companions} />
            </DetailSection>
          )}

          {(journey.tags.length > 0 || (journey.notes !== null && journey.notes.length > 0)) && (
            <DetailSection title={t("rail:form.notes")}>
              {journey.notes && (
                <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
                  {journey.notes}
                </p>
              )}
              {journey.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {journey.tags.map((tag) => (
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
        <RailFormModal
          journey={editing.mode === "edit" ? journey : null}
          initialDraft={editing.mode === "connection" ? connectionDraftFrom(journey) : undefined}
          connectsFrom={editing.mode === "connection" ? journey.id : undefined}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("rail:delete")}
        message={withDocumentNote(t("rail:deleteConfirm"), t, documentCount)}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}

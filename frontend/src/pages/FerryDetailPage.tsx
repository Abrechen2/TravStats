import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailSection from "../components/ui/DetailSection";
import DetailKpis from "../components/ui/DetailKpis";
import PeopleList from "../components/ui/PeopleList";
import TripPill from "../components/Trips/TripPill";
import { Icon } from "../components/ui/Icon";
import { statusPillProps } from "../components/table/statusPillStyle";
import ListLoadFailed from "../components/table/ListLoadFailed";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { ferryDeleteMessage } from "../lib/ferry/ferryDeleteMessage";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { formatRailDuration } from "../lib/rail/railDuration";
import Button from "../components/ui/Button";
import DocumentsSection from "../components/documents/DocumentsSection";
import ConfirmModal from "../components/Training/ConfirmModal";
import { FerryLivePosition } from "../components/ferry/FerryLivePosition";
import { FerryRoadtripLink } from "../components/ferry/FerryRoadtripLink";
import { useToursVisible } from "../hooks/useToursVisible";
import { FerryFormModal } from "../components/ferry/FerryFormModal";
import { useTranslation } from "../hooks/useTranslation";
import { ferryApi } from "../lib/api/ferry";
import { railArrival, railDeparture } from "../lib/entityTimes";
import { formatStationTime, railDurationMinutes } from "../lib/railTime";
import type { FerryJourney } from "../types/ferry";
export default function FerryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toursVisible = useToursVisible();
  const { t, i18n } = useTranslation(["ferry", "common", "rail", "documents"]);
  const [ride, setRide] = useState<FerryJourney | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const documentCount = useDocumentCount(
    deleting && ride ? { type: "ferryJourney", id: ride.id } : null
  );
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setError(false);
    setRide(null);
    let live = true;
    if (id)
      void ferryApi
        .get(id)
        .then((value) => {
          if (live) setRide(value);
        })
        .catch(() => {
          if (live) setError(true);
        });
    return () => {
      live = false;
    };
  }, [id, reload]);
  const remove = async () => {
    if (!ride || busy) return;
    setBusy(true);
    try {
      await ferryApi.remove(ride.id);
      navigate("/ferry");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  if (!ride)
    return (
      <AppShell width="list">
        <Link to="/ferry" className="ts-back-link text-sm text-(--text-muted)">
          {t("ferry:title")}
        </Link>
        {error ? (
          <ListLoadFailed
            title={t("ferry:error")}
            onRetry={() => setReload((n) => n + 1)}
            log={null}
          />
        ) : (
          <p role="status" className="text-(--text-muted)">
            {t("common:loading")}
          </p>
        )}
      </AppShell>
    );
  const dep = railDeparture(ride),
    arr = railArrival(ride),
    duration = dep ? railDurationMinutes(dep, arr) : null;
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const distanceLabel = t(
    ride.distanceSource === "user" ? "ferry:distanceKm" : "ferry:straightDistance"
  );
  const kpis = [
    ...(duration === null
      ? []
      : [{ key: "duration", value: formatRailDuration(duration, t), label: t("ferry:duration") }]),
    ...(ride.distanceKm === null
      ? []
      : [
          {
            key: "distance",
            value: `${ride.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 })} km`,
            label: distanceLabel,
          },
        ]),
    ...(ride.price === null
      ? []
      : [
          {
            key: "price",
            value: `${ride.price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ride.currency ?? ""}`,
            label: t("ferry:price"),
          },
        ]),
  ];
  return (
    <AppShell width="list">
      <DetailHeader
        domain="ferry"
        icon={<Icon name="ship" size={24} />}
        backTo="/ferry"
        backLabel={t("ferry:title")}
        title={`${ride.depStationName} → ${ride.arrStationName}`}
        subtitle={[ride.operator, ride.vesselName].filter(Boolean).join(" · ") || undefined}
        status={<span {...statusPillProps(ride.status)}>{t(`ferry:status.${ride.status}`)}</span>}
        hero={<DetailKpis items={kpis} />}
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("ferry:edit")}</Button>
            <Button onClick={() => setDeleting(true)}>{t("ferry:remove")}</Button>
          </>
        }
      />
      {error && (
        <p role="alert" className="mb-4 text-sm text-(--danger)">
          {t("ferry:error")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection
            title={t("ferry:sections.route")}
            columns={2}
            facts={[
              { label: t("ferry:departure"), value: ride.depStationName },
              { label: t("ferry:arrival"), value: ride.arrStationName },
              {
                label: t("ferry:departureLocal"),
                value: dep ? formatStationTime(dep, locale) : null,
                mono: true,
              },
              {
                label: t("ferry:arrivalLocal"),
                value: arr ? formatStationTime(arr, locale) : null,
                mono: true,
              },
            ]}
          />
          <DetailSection
            title={t("ferry:sections.booking")}
            facts={(
              [
                "operator",
                "vesselName",
                "bookingReference",
                "ticketReference",
                "passengerCount",
                "cabinType",
                "seat",
              ] as const
            ).map((key) => ({ label: t(`ferry:${key}`), value: ride[key] }))}
          />
          <DetailSection
            title={t("ferry:sections.vehicle")}
            facts={(
              [
                "vehicleType",
                "vehicleRegistration",
                "vehicleLengthM",
                "vehicleWidthM",
                "vehicleHeightM",
              ] as const
            ).map((key) => ({
              label: t(`ferry:${key}`),
              value: typeof ride[key] === "number" ? ride[key].toLocaleString(locale) : ride[key],
            }))}
          />
          <DocumentsSection entry={{ type: "ferryJourney", id: ride.id }} />
        </div>
        <aside className="flex flex-col gap-6 md:col-span-2">
          <FerryLivePosition key={ride.id} id={ride.id} />
          {ride.trip && (
            <DetailSection title={t("ferry:trip")}>
              <TripPill trip={ride.trip} />
            </DetailSection>
          )}
          {ride.companions.length > 0 && (
            <DetailSection title={t("ferry:companionNames")}>
              <PeopleList names={ride.companions} />
            </DetailSection>
          )}
          {ride.notes && (
            <DetailSection title={t("ferry:notes")}>
              <p className="whitespace-pre-wrap break-words text-sm text-(--ts-text)">
                {ride.notes}
              </p>
            </DetailSection>
          )}
          {toursVisible && (
            <DetailSection title={t("ferry:roadtrip.title")}>
              <FerryRoadtripLink
                ride={ride}
                onSaved={() => {
                  void ferryApi
                    .get(ride.id)
                    .then(setRide)
                    .catch(() => setError(true));
                }}
              />
            </DetailSection>
          )}
        </aside>
      </div>
      {editing && (
        <FerryFormModal
          journey={ride}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setRide(saved);
            setEditing(false);
          }}
        />
      )}
      <ConfirmModal
        isOpen={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => void remove()}
        title={t("ferry:remove")}
        message={ferryDeleteMessage(t, ride, documentCount)}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
        isLoading={busy}
      />
    </AppShell>
  );
}

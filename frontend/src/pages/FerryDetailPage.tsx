import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import Button from "../components/ui/Button";
import DocumentsSection from "../components/documents/DocumentsSection";
import ConfirmModal from "../components/Training/ConfirmModal";
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
  const { t, i18n } = useTranslation(["ferry", "common"]);
  const [ride, setRide] = useState<FerryJourney | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
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
  }, [id]);
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
      <AppShell>
        <p role={error ? "alert" : "status"}>{t(error ? "ferry:error" : "common:loading")}</p>
      </AppShell>
    );
  const dep = railDeparture(ride),
    arr = railArrival(ride),
    duration = dep ? railDurationMinutes(dep, arr) : null;
  return (
    <AppShell>
      <div className="space-y-5 p-4">
        <DetailHeader
          domain="ferry"
          icon="⛴"
          backTo="/ferry"
          backLabel={t("ferry:title")}
          title={`${ride.depStationName} → ${ride.arrStationName}`}
          subtitle={ride.operator}
          status={t(`ferry:status.${ride.status}`)}
          actions={
            <>
              <Button onClick={() => setEditing(true)}>{t("ferry:edit")}</Button>
              <Button onClick={() => setDeleting(true)}>{t("ferry:remove")}</Button>
            </>
          }
        />
        {error && <p role="alert">{t("ferry:error")}</p>}
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt>{t("ferry:departureLocal")}</dt>
            <dd>{dep ? formatStationTime(dep, i18n.language) : "—"}</dd>
          </div>
          <div>
            <dt>{t("ferry:arrivalLocal")}</dt>
            <dd>{arr ? formatStationTime(arr, i18n.language) : "—"}</dd>
          </div>
          <div>
            <dt>{t("ferry:duration")}</dt>
            <dd>
              {duration === null ? "—" : `${Math.floor(duration / 60)} h ${duration % 60} min`}
            </dd>
          </div>
          <div>
            <dt>
              {t(ride.distanceSource === "user" ? "ferry:distanceKm" : "ferry:straightDistance")}
            </dt>
            <dd>
              {ride.distanceKm?.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) ?? "—"}{" "}
              km
            </dd>
          </div>
          {(
            [
              "vesselName",
              "bookingReference",
              "ticketReference",
              "vehicleType",
              "vehicleRegistration",
              "vehicleLengthM",
              "vehicleWidthM",
              "vehicleHeightM",
              "passengerCount",
              "cabinType",
              "seat",
              "price",
              "currency",
              "notes",
            ] as const
          ).map((key) => (
            <div key={key}>
              <dt>{t(`ferry:${key}`)}</dt>
              <dd>{ride[key] ?? "—"}</dd>
            </div>
          ))}
          <div>
            <dt>{t("ferry:companions")}</dt>
            <dd>{ride.companions.join(", ") || "—"}</dd>
          </div>
        </dl>
        {toursVisible && (
          <FerryRoadtripLink
            ride={ride}
            onSaved={() => {
              void ferryApi
                .get(ride.id)
                .then(setRide)
                .catch(() => setError(true));
            }}
          />
        )}
        <DocumentsSection entry={{ type: "ferryJourney", id: ride.id }} />
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
          message={t("ferry:confirmDelete")}
          isLoading={busy}
        />
      </div>
    </AppShell>
  );
}

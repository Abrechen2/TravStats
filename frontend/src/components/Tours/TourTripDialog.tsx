import { useEffect, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { tripsApi } from "../../lib/api/trips";
import type { TourSummary } from "../../lib/api/tourIndex";
import type { Trip } from "../../types";
import { moveTourToTrip } from "./tourTripMove";

interface Props {
  tour: TourSummary;
  onClose: () => void;
  /** The tour now belongs to this trip; the caller re-reads its list. */
  onMoved: () => void;
}

/**
 * "Move to trip": pick the trip a tour belongs to. Three states for the trip
 * list (loading, failed with retry, loaded) so a failed read never looks like
 * "you have no trips", and a refused move says why inside the dialog.
 */
export default function TourTripDialog({ tour, onClose, onMoved }: Props): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState(tour.tripId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerPhotos, setOfferPhotos] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    tripsApi
      .getAll()
      .then((list) => {
        if (!cancelled) setTrips(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const submit = async (detachPhotos = false): Promise<void> => {
    if (!choice || choice === tour.tripId) return;
    setSaving(true);
    setError(null);
    setOfferPhotos(false);
    const result = await moveTourToTrip(tour.id, choice, { detachPhotos });
    setSaving(false);
    if (result.ok) {
      onMoved();
      return;
    }
    setError(t(`trips:${result.errorKey}`));
    setOfferPhotos(result.canDetachPhotos);
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      title={t("trips:tours.move.title", { name: tour.name })}
      maxWidth={480}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !choice || choice === tour.tripId}
            className="btn-primary rounded-md px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {t("trips:tours.move.confirm")}
          </button>
        </>
      }
    >
      {loadError ? (
        <div role="alert" className="text-sm">
          <p style={{ color: "var(--danger)" }}>{t("trips:tours.move.loadError")}</p>
          <button type="button" className="mt-2 underline" onClick={() => setAttempt((n) => n + 1)}>
            {t("common:buttons.retry")}
          </button>
        </div>
      ) : trips === null ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : trips.length === 0 ? (
        <p className="text-sm text-(--text-muted)">{t("trips:tours.move.noTrips")}</p>
      ) : (
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label={t("trips:tours.move.tripLabel")}
          className="w-full rounded-sm border border-(--color-border) bg-transparent px-2 py-2 text-sm"
        >
          <option value="" disabled>
            {t("trips:tours.move.pick")}
          </option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {offerPhotos && (
        <button
          type="button"
          disabled={saving}
          className="mt-2 text-sm underline"
          onClick={() => void submit(true)}
        >
          {t("trips:tours.move.detachPhotosConfirm")}
        </button>
      )}
    </Modal>
  );
}

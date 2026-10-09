import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { formatDayLong, todayIn } from "../../shared/time";
import { createVisit, updateVisit, uploadVisitPhotos } from "../../lib/api/places";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import type { Trip } from "../../types";
import type { PlaceVisit } from "../../types/place";
import {
  FormErrorBanner,
  RequiredMark,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { VisitDateChips } from "./VisitDateChips";
import {
  NO_TRIP,
  draftDay,
  isAheadOf,
  visitDraft,
  visitPayload,
  type VisitDateMode,
} from "./visitDialogModel";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";
const DATE_ID = "visit-dialog-date";
const HINT_ID = "visit-dialog-save-blocked";
const PHOTOS_ID = "visit-dialog-photos";
/** `uploadPlacePhotos.array("photos", 20)` on the server. */
const MAX_PHOTOS = 20;
const MODES: readonly VisitDateMode[] = ["today", "other", "unknown"];

interface Props {
  place: { id: string; name: string };
  /** The visit to edit; absent to record a new one. */
  visit?: PlaceVisit | null;
  onClose: () => void;
  /** Runs after the visit (and any photo) is stored — e.g. reload the page. */
  onSaved: (visit: PlaceVisit) => void | Promise<void>;
  /** What the "stored, but the follow-up failed" notice names. */
  afterSaveFailedKey?: string;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}

/**
 * Record a visit — or correct one — from wherever the place is in view: its
 * page, a row of the list, a pin on the map, the nearby view (forgejo#231).
 *
 * One dialog for all of them: the place page's inline panel used to be the
 * only way in, with errors as toasts and nothing between a second tap and a
 * second visit.
 *
 * - When: "Heute" / "Anderes Datum" / "Datum unbekannt" — unknown is `null`,
 *   never a made-up day; today is the user's today (`useTodayZone`).
 * - Optional: trip, note, and on a new visit photos — uploaded after the visit
 *   is stored, so a photo that fails never costs the visit, and is said as
 *   such with a retry for the photo alone (forgejo#247).
 * - One request per save (`useSaveOnce`): repeated taps while it is running
 *   cannot create a second visit. A failure keeps everything typed.
 *
 * Pattern (forgejo#245): **disabled save + `SaveBlockedHint`** — the only
 * thing that can be missing is the day in "Anderes Datum".
 */
export function VisitDialog({
  place,
  visit = null,
  onClose,
  onSaved,
  afterSaveFailedKey,
  onReload,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const isEdit = visit !== null;
  const today = todayIn(useTodayZone());

  const initial = visitDraft(visit);
  const [mode, setMode] = useState<VisitDateMode>(initial.mode);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [notes, setNotes] = useState(initial.notes);
  const [tripId, setTripId] = useState(initial.tripId);
  const [files, setFiles] = useState<File[]>([]);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsFailed, setTripsFailed] = useState(false);
  const [tripsAttempt, setTripsAttempt] = useState(0);

  /** The stored visit while its photo upload is being retried or skipped. */
  const [stored, setStored] = useState<PlaceVisit | null>(null);
  const [photoFailure, setPhotoFailure] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTripsFailed(false);
    void (async () => {
      try {
        const rows = await tripsApi.getAll();
        if (!cancelled) setTrips(rows);
      } catch (err: unknown) {
        // The visit can still be filed by date or on no trip; the list of
        // trips to pick from is what is missing, and the dialog says so.
        logger.error({ err }, "VisitDialog: could not load trips");
        if (!cancelled) setTripsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripsAttempt]);

  const draft = { mode, date, time, notes, tripId };
  // The photos are input too: closing must not drop a picked file silently.
  const snapshot = { ...draft, files: files.map((f) => `${f.name}:${f.size}`) };
  const { dirty, markSaved } = useDirtyGuard({ ...initial, files: [] }, snapshot);
  const saving = useSaveOnce<PlaceVisit>({ afterSaveFailedKey });
  const failure = useFormFailure(JSON.stringify(snapshot));

  const day = draftDay(draft, today);
  const ahead = isAheadOf(day, today);
  const offerPhotos = !isEdit && !ahead;

  const missing: MissingStep[] = [
    ...(mode === "other" && date === ""
      ? [{ field: DATE_ID, label: t("places:detail.date") }]
      : []),
    // The server takes at most 20 photographs per upload (review M3) — said
    // here, before the visit is stored, not as a refusal afterwards.
    ...(offerPhotos && files.length > MAX_PHOTOS
      ? [{ field: PHOTOS_ID, label: t("places:visit.photosTooMany", { max: MAX_PHOTOS }) }]
      : []),
  ];

  const finish = async (saved: PlaceVisit): Promise<void> => {
    try {
      await onSaved(saved);
    } catch (err: unknown) {
      logger.error({ err }, "VisitDialog: the follow-up after saving failed");
      setFinishFailed(true);
    }
  };

  /** Upload the picked photos to a stored visit; a refusal is said, never lost. */
  const uploadPhotos = async (saved: PlaceVisit): Promise<boolean> => {
    try {
      await uploadVisitPhotos(saved.id, files);
      setPhotoFailure(null);
      return true;
    } catch (err: unknown) {
      logger.error({ err }, "VisitDialog: the visit is stored, its photos are not");
      setStored(saved);
      setPhotoFailure(saveErrorKey(err, "places:visit.photoFailed"));
      return false;
    }
  };

  const handleSave = async (): Promise<void> => {
    if (missing.length > 0) return;
    const input = visitPayload(draft, today, place.id);
    failure.clear();
    const outcome = await saving.save(
      () => (visit ? updateVisit(visit.id, input) : createVisit(place.id, input)),
      async (saved) => {
        markSaved();
        if (offerPhotos && files.length > 0 && !(await uploadPhotos(saved))) return;
        await onSaved(saved);
      }
    );
    if (outcome.status === "failed") {
      logger.error({ err: outcome.error }, "VisitDialog: save failed");
      failure.fail(
        saveErrorKey(
          outcome.error,
          isEdit ? "places:detail.visitUpdateFailed" : "places:detail.visitFailed",
          {},
          { create: !isEdit }
        )
      );
    }
  };

  const retryPhotos = async (): Promise<void> => {
    if (stored === null || uploading) return;
    setUploading(true);
    try {
      if (await uploadPhotos(stored)) await finish(stored);
    } finally {
      setUploading(false);
    }
  };

  const partial = stored !== null && photoFailure !== null;

  return (
    <Modal
      open
      // Once the visit is stored, every way out is "continue without the
      // photo": the caller must learn of the visit.
      onClose={partial && stored !== null ? () => void finish(stored) : onClose}
      busy={saving.saving || uploading}
      dirty={dirty}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      title={
        isEdit ? t("places:detail.editVisit") : t("places:visit.recordTitle", { name: place.name })
      }
      footer={(requestClose) =>
        saving.afterSaveFailed || finishFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button type="button" onClick={onClose} className={`btn-primary ${COARSE}`}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : partial && stored !== null && photoFailure !== null ? (
          <>
            <p
              role="alert"
              className="mr-auto self-center text-sm"
              style={{ color: "var(--ts-warn)" }}
            >
              {t("places:visit.savedPhotoFailed", { reason: t(photoFailure) })}
            </p>
            {/* Only where asking again can help (review M3): a demo account or
                an unsupported file is refused identically every time. */}
            {isTransientSaveError(photoFailure) && (
              <button
                type="button"
                onClick={() => void retryPhotos()}
                disabled={uploading}
                className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
                style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
              >
                {uploading ? t("common:buttons.saving") : t("places:visit.photoRetry")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void finish(stored)}
              disabled={uploading}
              className={`btn-primary disabled:opacity-50 ${COARSE}`}
            >
              {t("places:visit.continueWithoutPhoto")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={HINT_ID} missing={missing} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving.saving}
              className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className={`btn-primary disabled:opacity-50 ${COARSE}`}
            >
              {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef} className="flex flex-col gap-4">
        <fieldset>
          <legend className="t-caption mb-1">{t("places:visit.when")}</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-2 text-sm ${COARSE}`}
                style={
                  mode === m
                    ? {
                        border: "1px solid var(--domain-poi)",
                        color: "var(--domain-poi)",
                        background: "rgba(94,194,178,0.1)",
                      }
                    : { border: "1px solid var(--color-border)", color: "var(--text-muted)" }
                }
              >
                {t(`places:visit.mode.${m}`)}
                {/* The day in words, not ISO: the default writes a date, so it
                    has to be legible at a glance (review M6). */}
                {m === "today" && mode === "today"
                  ? ` · ${formatDayLong(today, i18n.language, { day: "numeric", month: "short" })}`
                  : ""}
              </button>
            ))}
          </div>
        </fieldset>

        {mode === "other" && (
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labelled
                id={DATE_ID}
                label={
                  <>
                    {t("places:detail.date")} <RequiredMark />
                  </>
                }
              >
                <input
                  id={DATE_ID}
                  type="date"
                  aria-required="true"
                  className={INPUT}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Labelled>
              <TimeField value={time} onChange={setTime} />
            </div>
            <VisitDateChips
              placeId={place.id}
              tripId={tripId === NO_TRIP ? "" : tripId}
              value={date}
              onPick={setDate}
            />
          </div>
        )}
        {mode === "today" && <TimeField value={time} onChange={setTime} />}
        {mode === "unknown" && <p className="t-caption">{t("places:visit.unknownHint")}</p>}
        {ahead && (
          <p className="t-caption" role="status">
            {t("places:visit.aheadHint")}
          </p>
        )}

        <Labelled id="visit-dialog-trip" label={t("places:detail.visitTrip")}>
          <select
            id="visit-dialog-trip"
            className={INPUT}
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
          >
            {!isEdit && <option value="">{t("places:detail.visitTripByDate")}</option>}
            <option value={NO_TRIP}>{t("places:detail.visitNoTrip")}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </Labelled>
        {tripsFailed && (
          <p role="status" className="t-caption -mt-2 flex flex-wrap items-center gap-2">
            {t("places:visit.tripsFailed")}
            <button
              type="button"
              onClick={() => setTripsAttempt((n) => n + 1)}
              className={`underline ${COARSE}`}
            >
              {t("common:buttons.retry")}
            </button>
          </p>
        )}

        <Labelled id="visit-dialog-notes" label={t("places:detail.visitNotes")}>
          <input
            id="visit-dialog-notes"
            className={INPUT}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Labelled>

        {offerPhotos && (
          <Labelled id="visit-dialog-photos" label={t("places:visit.photos")}>
            <input
              id={PHOTOS_ID}
              type="file"
              accept="image/*"
              multiple
              aria-describedby="visit-dialog-photos-hint"
              className={`text-sm ${COARSE}`}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <span id="visit-dialog-photos-hint" className="t-caption">
              {files.length > 0
                ? t("places:visit.photosPicked", { count: files.length })
                : t("places:visit.photosHint", { max: MAX_PHOTOS })}
            </span>
          </Labelled>
        )}

        {/* Both halves of the rule, said plainly, because both surprise
            people: a date is optional, and a future one does not count. */}
        <p className="t-caption">{t("places:detail.dateHint")}</p>

        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? () => void handleSave()
              : undefined
          }
          retryDisabled={saving.saving}
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
      </div>
    </Modal>
  );
}

const INPUT = `w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] ${COARSE}`;

function Labelled({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="t-caption">
        {label}
      </label>
      {children}
    </div>
  );
}

function TimeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["places"]);
  return (
    <Labelled id="visit-dialog-time" label={t("places:visit.timeOptional")}>
      <input
        id="visit-dialog-time"
        type="time"
        className={INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Labelled>
  );
}

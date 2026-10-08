import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import CurrencySelect from "../common/CurrencySelect";
import SuggestionChips from "../common/SuggestionChips";
import TagInput from "../TagInput";
import CompanionPicker from "../CompanionPicker";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useBusEntrySuggestions } from "../../hooks/useBusEntrySuggestions";
import { useTranslation } from "../../hooks/useTranslation";
import { minorUnits } from "../../shared/currencies";
import { busApi } from "../../lib/api/bus";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import type { Trip } from "../../types";
import { BUS_RIDE_KINDS, type BusJourney, type BusRideKind } from "../../types/bus";
import { BusStationField, type BusStationDraft } from "./BusStationField";
import { BusTerminalChips } from "./BusTerminalChips";
import { BusTimeField } from "./BusTimeField";
import {
  canSubmit,
  dayPart,
  draftFrom,
  hasClocklessEnd,
  isTerminalComplete,
  knownTerminalZone,
  saveErrorFrom,
  toBusInput,
  withClock,
  type BusFormDraft,
  type BusSaveError,
} from "./busFormModel";

interface Props {
  /** The ride to edit; null for a new one. */
  journey: BusJourney | null;
  onClose: () => void;
  onSaved: (ride: BusJourney) => void | Promise<void>;
}

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

/**
 * Create or edit one coach ride (spec 2026-10-07-bus-domain-design).
 *
 * Times are entered on each terminal's own clock and sent without an offset;
 * the server finds the zone from the terminal and stores the instant. The
 * status is not a field: it follows from the times, and only a cancellation
 * is the user's to state. A failed save is shown as itself beside the field
 * it names and never calls `onSaved`.
 */
export function BusFormModal({ journey, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["bus", "common"]);
  const recentCurrencies = useRecentCurrencies();
  const [draft, setDraft] = useState<BusFormDraft>(() => draftFrom(journey));
  /** The draft as the ride opened, to tell a time changed away and back from one really changed. */
  const [opened] = useState<BusFormDraft>(() => draftFrom(journey));
  const [trips, setTrips] = useState<Trip[]>([]);
  const [depValid, setDepValid] = useState(true);
  const [arrValid, setArrValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<BusSaveError | null>(null);
  /** The ride the API accepted. From then on the save button is off: a second click would create it again. */
  const [saved, setSaved] = useState<BusJourney | null>(null);

  // An edit ends a shown refusal: it described the input as it WAS, and
  // leaving it up beside a field the user has since changed reads as still true.
  const set = <K extends keyof BusFormDraft>(key: K, value: BusFormDraft[K]): void => {
    setError(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Non-fatal on purpose: without the list the field offers "no trip", which
  // beats taking the dialog down over a side lookup.
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err: unknown) => logger.warn("BusFormModal: failed to load trips", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // A NEW ride is filed under the one trip whose dates contain its departure
  // day, as flights, cruises, stays and rail are; a pick by hand ends it.
  const pickTrip = useTripPreselection({
    enabled: journey === null,
    trips,
    date: draft.departureLocal,
    value: draft.tripId,
    onChange: (tripId) => set("tripId", tripId),
  });

  const { suggestions, failed: suggestionsFailed } = useBusEntrySuggestions({
    departureName: draft.departure.name,
    arrivalName: draft.arrival.name,
    operator: draft.operator,
  });

  // A moved terminal may sit in another zone, where the stored occurrence of a
  // repeated hour means nothing: the fold is dropped with the place it was read at.
  const setTerminal = (end: "departure" | "arrival", next: BusStationDraft): void => {
    setError(null);
    setDraft((prev) => {
      const moved = prev[end].lat !== next.lat || prev[end].lon !== next.lon;
      return { ...prev, [end]: next, ...(moved ? { [`${end}Fold`]: null } : {}) };
    });
  };

  /**
   * A typed time ends the stored occurrence of a repeated hour: it was the old
   * clock's. Typing the clock the ride OPENED with, on the terminal it opened
   * with, gives it back — a change away and back must not move the ride.
   */
  const setTime = (end: "departure" | "arrival", value: string): void => {
    setError(null);
    setDraft((prev) => {
      const sameClock = value === opened[`${end}Local`] && !opened[`${end}DayOnly`];
      const sameTerminal = prev[end].lat === opened[end].lat && prev[end].lon === opened[end].lon;
      const fold = sameClock && sameTerminal ? opened[`${end}Fold`] : null;
      return { ...prev, [`${end}Local`]: value, [`${end}Fold`]: fold };
    });
  };

  const toggleDayOnly = (end: "departure" | "arrival", dayOnly: boolean): void => {
    setError(null);
    setDraft((prev) => {
      const local = prev[`${end}Local`];
      return {
        ...prev,
        [`${end}DayOnly`]: dayOnly,
        [`${end}Local`]: dayOnly ? dayPart(local) : withClock(local),
        [`${end}Fold`]: null,
      };
    });
  };

  const delayBlocked = hasClocklessEnd(draft);
  const ready = canSubmit(draft) && depValid && arrValid && saved === null;
  const errorText =
    error === null
      ? null
      : t(error.key, error.fieldLabelKey ? { field: t(error.fieldLabelKey) } : undefined);
  /** The refusal shown under a time field, with the input marked invalid. */
  const fieldError = (field: "departureLocal" | "arrivalLocal") =>
    error?.field === field
      ? {
          input: { "aria-invalid": true, "aria-describedby": `bus-${field}-error` } as const,
          message: (
            <p id={`bus-${field}-error`} role="alert" className="mt-1 text-sm text-(--danger)">
              {errorText}
            </p>
          ),
        }
      : { input: {}, message: null };
  const depError = fieldError("departureLocal");
  const arrError = fieldError("arrivalLocal");

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    let accepted: BusJourney;
    try {
      const input = toBusInput(draft);
      accepted = journey ? await busApi.update(journey.id, input) : await busApi.create(input);
    } catch (err: unknown) {
      logger.error("BusFormModal: save failed", err);
      setError(saveErrorFrom(err));
      setSaving(false);
      return;
    }
    // The ride is stored. What the parent does next (refetch, navigate) is its
    // own business: its failure is not a refusal of this form, and a retry
    // here would file the ride a second time.
    setSaved(accepted);
    try {
      await onSaved(accepted);
    } catch (err: unknown) {
      logger.error("BusFormModal: onSaved failed after the ride was saved", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      closeLabel={t("common:buttons.close")}
      title={journey ? t("bus:form.titleEdit") : t("bus:form.titleNew")}
      maxWidth={672}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("bus:form.cancel")}
          </button>
          <button
            type="button"
            onClick={(): void => void submit()}
            disabled={saving || !ready}
            data-testid="bus-form-save"
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
          >
            {saving ? t("bus:form.saving") : t("bus:form.save")}
          </button>
        </>
      }
    >
      <div data-testid="bus-form">
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <input
              className={INPUT_CLASS}
              aria-label={t("bus:form.operator")}
              placeholder={t("bus:form.operatorPlaceholder")}
              value={draft.operator}
              onChange={(e): void => set("operator", e.target.value)}
            />
            <SuggestionChips
              value={draft.operator}
              suggestions={suggestions.operators}
              onPick={(value): void => set("operator", value)}
              fieldLabel={t("bus:form.operator")}
            />
          </div>
          <input
            className={INPUT_CLASS}
            aria-label={t("bus:form.line")}
            placeholder={t("bus:form.linePlaceholder")}
            value={draft.lineName}
            onChange={(e): void => set("lineName", e.target.value)}
          />
          <select
            aria-label={t("bus:form.kind")}
            className={INPUT_CLASS}
            value={draft.rideKind}
            onChange={(e): void => set("rideKind", e.target.value as BusRideKind | "")}
          >
            <option value="">{t("bus:form.kindNone")}</option>
            {BUS_RIDE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`bus:kind.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="-mt-2 mb-4 text-xs text-(--text-muted)">{t("bus:form.kindHint")}</p>
        {suggestionsFailed && (
          <p className="t-caption mb-3" data-testid="bus-suggestions-failed">
            {t("bus:form.suggestionsFailed")}
          </p>
        )}

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <BusStationField
              label={t("bus:form.departureStation")}
              idPrefix="bus-dep"
              value={draft.departure}
              onChange={(next): void => setTerminal("departure", next)}
              onValidityChange={setDepValid}
              inputClassName={INPUT_CLASS}
            />
            <BusTerminalChips
              terminals={suggestions.terminals}
              value={draft.departure}
              fieldLabel={t("bus:form.departureStation")}
              onPick={(next): void => setTerminal("departure", next)}
              testId="bus-terminal-chips-dep"
            />
          </div>
          <div>
            <BusStationField
              label={t("bus:form.arrivalStation")}
              idPrefix="bus-arr"
              value={draft.arrival}
              onChange={(next): void => setTerminal("arrival", next)}
              onValidityChange={setArrValid}
              inputClassName={INPUT_CLASS}
            />
            <BusTerminalChips
              terminals={suggestions.terminals}
              value={draft.arrival}
              fieldLabel={t("bus:form.arrivalStation")}
              onPick={(next): void => setTerminal("arrival", next)}
              testId="bus-terminal-chips-arr"
            />
          </div>
        </div>
        {!(isTerminalComplete(draft.departure) && isTerminalComplete(draft.arrival)) && (
          <p className="mb-3 text-sm text-(--text-muted)">{t("bus:form.stationMissing")}</p>
        )}

        <div className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BusTimeField
              label={t("bus:form.departureTime")}
              testId="bus-time-dep"
              inputClassName={INPUT_CLASS}
              value={draft.departureLocal}
              dayOnly={draft.departureDayOnly}
              zone={knownTerminalZone(journey, "dep", draft.departure)}
              fold={draft.departureFold}
              invalid={depError.input}
              errorMessage={depError.message}
              onChange={(value): void => setTime("departure", value)}
              onDayOnlyChange={(dayOnly): void => toggleDayOnly("departure", dayOnly)}
              onFoldChange={(fold): void => set("departureFold", fold)}
            />
            <BusTimeField
              label={t("bus:form.arrivalTime")}
              testId="bus-time-arr"
              inputClassName={INPUT_CLASS}
              value={draft.arrivalLocal}
              dayOnly={draft.arrivalDayOnly}
              zone={knownTerminalZone(journey, "arr", draft.arrival)}
              fold={draft.arrivalFold}
              invalid={arrError.input}
              errorMessage={arrError.message}
              onChange={(value): void => setTime("arrival", value)}
              onDayOnlyChange={(dayOnly): void => toggleDayOnly("arrival", dayOnly)}
              onFoldChange={(fold): void => set("arrivalFold", fold)}
            />
          </div>
          <label className="mt-3 block text-sm">
            {t("bus:form.delay")}
            <input
              type="number"
              className={`mt-1 ${INPUT_CLASS}`}
              // The draft keeps what was typed, so unticking a box brings it back.
              value={delayBlocked ? "" : draft.delayMinutes}
              disabled={delayBlocked}
              aria-describedby={delayBlocked ? "bus-delay-needs-clock" : undefined}
              onChange={(e): void => set("delayMinutes", e.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-(--text-muted)">{t("bus:form.delayHint")}</p>
          {delayBlocked && (
            <p id="bus-delay-needs-clock" className="mt-1 text-xs text-(--text-muted)">
              {t("bus:form.delayNeedsClock")}
            </p>
          )}
          <label className="mt-3 block text-sm">
            {t("bus:form.distance")}
            <input
              type="number"
              min={0}
              step="0.1"
              className={`mt-1 ${INPUT_CLASS}`}
              value={draft.distanceKm}
              onChange={(e): void => set("distanceKm", e.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-(--text-muted)">{t("bus:form.distanceHint")}</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.cancelled}
              onChange={(e): void => set("cancelled", e.target.checked)}
            />
            {t("bus:form.cancelled")}
          </label>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <input
              className={INPUT_CLASS}
              aria-label={t("bus:form.class")}
              placeholder={t("bus:form.classPlaceholder")}
              value={draft.fareClass}
              onChange={(e): void => set("fareClass", e.target.value)}
            />
            <SuggestionChips
              value={draft.fareClass}
              suggestions={suggestions.fareClasses}
              onPick={(value): void => set("fareClass", value)}
              fieldLabel={t("bus:form.class")}
            />
          </div>
          <input
            className={INPUT_CLASS}
            aria-label={t("bus:form.seatNumber")}
            placeholder={t("bus:form.seatNumber")}
            value={draft.seat}
            onChange={(e): void => set("seat", e.target.value)}
          />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            className={INPUT_CLASS}
            aria-label={t("bus:form.bookingReference")}
            placeholder={t("bus:form.bookingReference")}
            value={draft.bookingReference}
            onChange={(e): void => set("bookingReference", e.target.value)}
          />
          <input
            type="number"
            min={0}
            step={10 ** -minorUnits(draft.currency)}
            className={INPUT_CLASS}
            aria-label={t("bus:form.price")}
            placeholder={t("bus:form.price")}
            value={draft.price}
            onChange={(e): void => set("price", e.target.value)}
          />
          <CurrencySelect
            aria-label={t("bus:form.currency")}
            value={draft.currency}
            recent={recentCurrencies}
            onChange={(code): void => set("currency", code)}
          />
        </div>

        <div className="mb-4">
          <TagInput
            ariaLabel={t("bus:form.tags")}
            className={INPUT_CLASS}
            placeholder={t("bus:form.tags")}
            value={draft.tags}
            onChange={(next): void => set("tags", next)}
          />
          <div className="mt-3">
            <span className="label">{t("bus:form.companions")}</span>
            <CompanionPicker
              value={draft.companions}
              onChange={(next): void => set("companions", next)}
            />
          </div>
          <label className="mt-3 block text-sm">
            {t("bus:form.trip")}
            <select
              className={`mt-1 ${INPUT_CLASS}`}
              value={draft.tripId}
              onChange={(e): void => pickTrip(e.target.value)}
            >
              <option value="">{t("bus:form.tripNone")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label={t("bus:form.notes")}
            rows={3}
            className={`mt-3 ${INPUT_CLASS}`}
            placeholder={t("bus:form.notes")}
            value={draft.notes}
            onChange={(e): void => set("notes", e.target.value)}
          />
        </div>

        {error !== null && error.field === null && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
          >
            {errorText}
          </div>
        )}
      </div>
    </Modal>
  );
}

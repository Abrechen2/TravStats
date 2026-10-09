import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import SuggestionChips from "../common/SuggestionChips";
import {
  FieldError,
  FormErrorBanner,
  RequiredLegend,
  SaveBlockedHint,
  fieldErrorProps,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { useBusEntrySuggestions } from "../../hooks/useBusEntrySuggestions";
import { useTranslation } from "../../hooks/useTranslation";
import { busApi } from "../../lib/api/bus";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { isOutcomeUnknownSaveError, isTransientSaveError } from "../../lib/saveErrorMessage";
import type { Trip } from "../../types";
import { BUS_RIDE_KINDS, type BusJourney, type BusRideKind } from "../../types/bus";
import { BusStationField, type BusStationDraft } from "./BusStationField";
import { BusTerminalChips } from "./BusTerminalChips";
import { BusTimeField } from "./BusTimeField";
import { BusFormDetails } from "./BusFormDetails";
import { CHECK_ROW, INPUT_CLASS, LabelledInput, hintId } from "./busFormFields";
import {
  busFieldId,
  canSubmit,
  dayPart,
  draftFrom,
  hasClocklessEnd,
  isTerminalComplete,
  knownTerminalZone,
  missingSteps,
  saveErrorFrom,
  toBusInput,
  withClock,
  type BadCoordinate,
  type BusFormDraft,
  type BusFormErrorField,
  type BusSaveError,
} from "./busFormModel";

interface Props {
  /** The ride to edit; null for a new one. */
  journey: BusJourney | null;
  onClose: () => void;
  onSaved: (ride: BusJourney) => void | Promise<void>;
  /**
   * What the "stored, but the follow-up failed" notice names: the list by
   * default; the detail page passes the view's wording.
   */
  afterSaveFailedKey?: string;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}

const HINT_ID = "bus-form-save-blocked";

/**
 * Create or edit one coach ride (spec 2026-10-07-bus-domain-design).
 *
 * Times are entered on each terminal's own clock and sent without an offset;
 * the server finds the zone from the terminal and stores the instant. The
 * status is not a field: it follows from the times, and only a cancellation
 * is the user's to state.
 *
 * Shared form blocks (forgejo#245–#249), pattern "disabled save +
 * `SaveBlockedHint`": the save stays greyed out until both terminals and the
 * departure are there, and the line beside it names each missing step. A
 * refusal by the server is shown at the field it names, or in the banner,
 * until the next edit; the first one gets focus. The ride is sent once
 * (`useSaveOnce`) — the bus form was the reference for that guarantee, now
 * in the shared hook — and a changed form asks before it is discarded.
 */
export function BusFormModal({
  journey,
  onClose,
  onSaved,
  afterSaveFailedKey,
  onReload,
}: Props): JSX.Element {
  const { t } = useTranslation(["bus", "common"]);
  // One function builds the state AND the dirty baseline, so an edit form
  // cannot open already "changed" (forgejo#248).
  const [draft, setDraft] = useState<BusFormDraft>(() => draftFrom(journey));
  /** The draft as the ride opened: the dirty baseline, and the clock a time changed away and back returns to. */
  const [opened] = useState<BusFormDraft>(() => draftFrom(journey));
  const [trips, setTrips] = useState<Trip[]>([]);
  const [depBad, setDepBad] = useState<BadCoordinate>(null);
  const [arrBad, setArrBad] = useState<BadCoordinate>(null);
  /** The last refusal; shown only while `failure` still holds it (until the next edit). */
  const [refusal, setRefusal] = useState<BusSaveError | null>(null);
  // A refused coordinate is something typed, so it counts as a change — the
  // lodging form's rule. A preselected trip needs no exclusion here (rail's
  // does): a new bus ride opens without a date, and the preselection follows
  // the typed date, so it is never set while the form is otherwise unchanged.
  const { dirty, markSaved } = useDirtyGuard(opened, {
    ...draft,
    // Null reads as absent, so an untouched form compares equal to the baseline.
    badDepartureCoordinate: depBad,
    badArrivalCoordinate: arrBad,
  });
  const saving = useSaveOnce<BusJourney>({ afterSaveFailedKey });
  const failure = useFormFailure(JSON.stringify(draft));

  const set = <K extends keyof BusFormDraft>(key: K, value: BusFormDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

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
  const setTerminal = (end: "departure" | "arrival", next: BusStationDraft): void =>
    setDraft((prev) => {
      const moved = prev[end].lat !== next.lat || prev[end].lon !== next.lon;
      return { ...prev, [end]: next, ...(moved ? { [`${end}Fold`]: null } : {}) };
    });

  /**
   * A typed time ends the stored occurrence of a repeated hour: it was the old
   * clock's. Typing the clock the ride OPENED with, on the terminal it opened
   * with, gives it back — a change away and back must not move the ride.
   */
  const setTime = (end: "departure" | "arrival", value: string): void =>
    setDraft((prev) => {
      const sameClock = value === opened[`${end}Local`] && !opened[`${end}DayOnly`];
      const sameTerminal = prev[end].lat === opened[end].lat && prev[end].lon === opened[end].lon;
      const fold = sameClock && sameTerminal ? opened[`${end}Fold`] : null;
      return { ...prev, [`${end}Local`]: value, [`${end}Fold`]: fold };
    });

  const toggleDayOnly = (end: "departure" | "arrival", dayOnly: boolean): void =>
    setDraft((prev) => {
      const local = prev[`${end}Local`];
      return {
        ...prev,
        [`${end}DayOnly`]: dayOnly,
        [`${end}Local`]: dayOnly ? dayPart(local) : withClock(local),
        [`${end}Fold`]: null,
      };
    });

  const delayBlocked = hasClocklessEnd(draft);
  const ready = canSubmit(draft) && depBad === null && arrBad === null;
  // What keeps the save greyed out, said beside it (forgejo#245): the same
  // conditions as `ready`, one item per gap, each focusing its field.
  const missing: MissingStep[] = missingSteps(draft, { departure: depBad, arrival: arrBad }).map(
    (step) => ({ field: step.field, label: t(step.labelKey) })
  );
  const shown = failure.failureKey !== null ? refusal : null;
  const errorText =
    shown === null
      ? null
      : t(shown.key, shown.fieldLabelKey ? { field: t(shown.fieldLabelKey) } : undefined);
  /** A refusal naming a plain field, at that field (forgejo#246). */
  const fieldError = (field: BusFormErrorField): string | null =>
    shown?.field === field ? errorText : null;
  const bannerText = shown !== null && shown.field === null ? errorText : null;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    failure.clear();
    const input = toBusInput(draft);
    // The request and what follows are two steps (forgejo#247): the ride is
    // stored once the API accepts it, and a parent whose refetch fails must
    // not turn that into "nicht gespeichert" — the next click would file the
    // ride a second time. `useSaveOnce` sends nothing after a success.
    const outcome = await saving.save(
      () => (journey ? busApi.update(journey.id, input) : busApi.create(input)),
      async (saved) => {
        markSaved();
        await onSaved(saved);
      }
    );
    if (outcome.status === "failed") {
      logger.error("BusFormModal: save failed", outcome.error);
      const refused = saveErrorFrom(outcome.error, { create: !journey });
      setRefusal(refused);
      failure.fail(refused.key);
    } else if (outcome.status === "savedButAfterFailed") {
      logger.error("BusFormModal: onSaved failed after the ride was saved", outcome.error);
    }
  };

  const blocked = saving.saving || saving.saved !== null || !ready;

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      closeLabel={t("common:buttons.close")}
      title={journey ? t("bus:form.titleEdit") : t("bus:form.titleNew")}
      maxWidth={672}
      footer={(requestClose) =>
        // Stored, but the follow-up failed: closing is the only honest action
        // left — another "Speichern" would send nothing (`useSaveOnce`).
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-(--text-muted)">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim)"
            >
              {t("common:buttons.close")}
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
              className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
            >
              {t("bus:form.cancel")}
            </button>
            <button
              type="button"
              onClick={(): void => void submit()}
              disabled={blocked}
              aria-describedby={HINT_ID}
              data-testid="bus-form-save"
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {saving.saving ? t("bus:form.saving") : t("bus:form.save")}
            </button>
          </>
        )
      }
    >
      <div data-testid="bus-form" ref={failure.rootRef}>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <LabelledInput
              label={t("bus:form.operator")}
              field="operator"
              error={fieldError("operator")}
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
          <LabelledInput
            label={t("bus:form.line")}
            field="lineName"
            error={fieldError("lineName")}
            placeholder={t("bus:form.linePlaceholder")}
            value={draft.lineName}
            onChange={(e): void => set("lineName", e.target.value)}
          />
          <div>
            <label className="block text-sm">
              {t("bus:form.kind")}
              <select
                id={busFieldId("rideKind")}
                className={`mt-1 ${INPUT_CLASS}`}
                value={draft.rideKind}
                onChange={(e): void => set("rideKind", e.target.value as BusRideKind | "")}
                {...fieldErrorProps(
                  busFieldId("rideKind"),
                  fieldError("rideKind"),
                  hintId("rideKind")
                )}
              >
                <option value="">{t("bus:form.kindNone")}</option>
                {BUS_RIDE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`bus:kind.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
            <FieldError id={busFieldId("rideKind")} error={fieldError("rideKind")} />
          </div>
        </div>
        <p id={hintId("rideKind")} className="-mt-2 mb-4 text-xs text-(--text-muted)">
          {t("bus:form.kindHint")}
        </p>
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
              required
              value={draft.departure}
              onChange={(next): void => setTerminal("departure", next)}
              onValidityChange={(valid, field): void => setDepBad(valid ? null : (field ?? "lat"))}
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
              required
              value={draft.arrival}
              onChange={(next): void => setTerminal("arrival", next)}
              onValidityChange={(valid, field): void => setArrBad(valid ? null : (field ?? "lat"))}
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
              field="departureLocal"
              label={t("bus:form.departureTime")}
              required
              testId="bus-time-dep"
              inputClassName={INPUT_CLASS}
              value={draft.departureLocal}
              dayOnly={draft.departureDayOnly}
              zone={knownTerminalZone(journey, "dep", draft.departure)}
              fold={draft.departureFold}
              error={fieldError("departureLocal")}
              onChange={(value): void => setTime("departure", value)}
              onDayOnlyChange={(dayOnly): void => toggleDayOnly("departure", dayOnly)}
              onFoldChange={(fold): void => set("departureFold", fold)}
            />
            <BusTimeField
              field="arrivalLocal"
              label={t("bus:form.arrivalTime")}
              testId="bus-time-arr"
              inputClassName={INPUT_CLASS}
              value={draft.arrivalLocal}
              dayOnly={draft.arrivalDayOnly}
              zone={knownTerminalZone(journey, "arr", draft.arrival)}
              fold={draft.arrivalFold}
              error={fieldError("arrivalLocal")}
              onChange={(value): void => setTime("arrival", value)}
              onDayOnlyChange={(dayOnly): void => toggleDayOnly("arrival", dayOnly)}
              onFoldChange={(fold): void => set("arrivalFold", fold)}
            />
          </div>
          <div className="mt-3">
            <LabelledInput
              label={t("bus:form.delay")}
              field="delayMinutes"
              error={fieldError("delayMinutes")}
              type="number"
              // The draft keeps what was typed, so unticking a box brings it back.
              value={delayBlocked ? "" : draft.delayMinutes}
              disabled={delayBlocked}
              hint={
                <>
                  {t("bus:form.delayHint")}
                  {delayBlocked && <> {t("bus:form.delayNeedsClock")}</>}
                </>
              }
              onChange={(e): void => set("delayMinutes", e.target.value)}
            />
          </div>
          <div className="mt-3">
            <LabelledInput
              label={t("bus:form.distance")}
              field="distanceKm"
              error={fieldError("distanceKm")}
              type="number"
              min={0}
              step="0.1"
              value={draft.distanceKm}
              hint={t("bus:form.distanceHint")}
              onChange={(e): void => set("distanceKm", e.target.value)}
            />
          </div>
          <label className={`mt-3 ${CHECK_ROW}`}>
            <input
              type="checkbox"
              checked={draft.cancelled}
              onChange={(e): void => set("cancelled", e.target.checked)}
            />
            {t("bus:form.cancelled")}
          </label>
        </div>

        <BusFormDetails
          draft={draft}
          set={set}
          fareClasses={suggestions.fareClasses}
          trips={trips}
          pickTrip={pickTrip}
          errorFor={fieldError}
        />

        <FormErrorBanner
          message={bannerText}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? (): void => void submit()
              : undefined
          }
          retryDisabled={saving.saving}
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
        <RequiredLegend className="mt-3" />
      </div>
    </Modal>
  );
}

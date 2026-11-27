import { useMemo, useRef } from "react";
import { tripsApi } from "../../lib/api/trips";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import { storeHistoricalFlightTime } from "../../lib/timeEstimation";
import type { Flight, FlightInput, UserAchievement } from "../../types";

export type { FlightLookupResult, DuplicateFlight, FlightSubmitOptions } from "./flightFormModel";
export { buildLocalString } from "./flightFormModel";
import { airportZone, buildFlightPayload as buildFlightPayloadFrom } from "./flightPayload";
import { useFlightSubmit } from "./useFlightSubmit";
import type { FlightSubmitOptions } from "./flightFormModel";
import { shiftWallClock } from "../../lib/wallClockMath";
import { useFlightFormState } from "./useFlightFormState";
import { useFlightFormEffects, type FlightFormRefs } from "./useFlightFormEffects";
import { useFlightLookupHandlers } from "./useFlightLookupHandlers";
import { useFlightReviewConfirm } from "./useFlightReviewConfirm";
import { prepareNextLegForm, prepareReturnLegForm } from "./flightFormReturn";
import { reportPageError } from "../../store/pageErrorStore";

export function useFlightForm(
  // Returning the created Flight makes the post-create trip assignment
  // possible; `void` keeps older callers valid (they get no assignment).
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>,
  onCancel: () => void,
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void,
  initialDate?: string
  /**
   * Opens straight into the e-mail/PDF uploader instead of the lookup step.
   * Used by the central import hub (#238): the hub carries the flight parse
   * route, but the multi-flight review loop lives here — so the hub sends the
   * user in rather than growing a second copy of it.
   */
) {
  const { t } = useTranslation(["flights", "errors"]);
  // Per-field selectors: the whole store would re-render the form on every
  // settings write, and re-run the defaults effect with it.
  const features = useSettingsStore((st) => st.features);

  const state = useFlightFormState();
  const { meta, ...fields } = state;
  const refs: FlightFormRefs = {
    stepNoticeRef: useRef<string | null>(null),
    // Track if arrival date has been set manually (or by a picked lookup hit)
    arrivalDateSetRef: useRef(false),
    // Accumulates confirmed flight inputs during multi-flight email import
    confirmedFlightsRef: useRef<FlightInput[]>([]),
  };
  useFlightFormEffects(state, refs, initialDate);
  const lookup = useFlightLookupHandlers(state, refs, t);

  const {
    status,
    departureDate,
    departureTime,
    arrivalDate,
    arrivalTime,
    departure,
    arrival,
    flightNumber,
    actualDepartureDate,
    actualDepartureTime,
    actualArrivalDate,
    actualArrivalTime,
    tripId,
  } = state;

  // Live validation. A historical row is allowed to carry a day without a
  // clock reading; an ordinary one is not. Blank scheduled times used to slip
  // through here and get backfilled with noon on the way out, so the flight
  // recorded a departure the user never typed. A half-filled actual pair
  // (date, no time) is blocked for the same reason — it fabricated an actual
  // departure and, with it, a delay.
  const actualPairIncomplete =
    (!!actualDepartureDate && !actualDepartureTime) || (!!actualArrivalDate && !actualArrivalTime);

  const canSubmit = useMemo(
    () =>
      status === "historical"
        ? !!(departure && arrival)
        : !!(
            departure &&
            arrival &&
            departureDate &&
            departureTime &&
            arrivalDate &&
            arrivalTime &&
            !actualPairIncomplete
          ),
    [
      departure,
      arrival,
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      actualPairIncomplete,
      status,
    ]
  );

  // A side's zone is its airport's, never a fallback (ADR 0002 D2; see airportZone).
  const depTz = airportZone(departure);
  const arrTz = airportZone(arrival);

  // Honour the user's "track aircraft registrations" opt-out: when off,
  // the lookup-derived tail number / Mode-S are dropped before submit so
  // the column stays NULL on the row. Default is ON.
  const trackAircraft = features?.trackAircraftRegistration !== false;

  // Passes the whole state and the hidden lookup metadata; the builder reads what it needs.
  const buildFlightPayload = (): FlightInput =>
    buildFlightPayloadFrom({ ...state, ...meta, trackAircraft, depTz, arrTz });

  const storeHistoricalData = () => {
    if (flightNumber && departureTime && arrivalTime && departure?.iata && arrival?.iata) {
      const estimatedBoardingTime =
        shiftWallClock(departureDate, departureTime, -30)?.time ?? departureTime;
      storeHistoricalFlightTime(
        flightNumber,
        departure.iata,
        arrival.iata,
        estimatedBoardingTime,
        departureTime,
        arrivalTime,
        departureDate
      );
    }
  };

  const prepareReturnFlightForm = (): void => prepareReturnLegForm(state, refs.arrivalDateSetRef);
  const prepareNextFlightForm = (): void => prepareNextLegForm(state, refs.arrivalDateSetRef);

  /** Post-create trip assignment (#199) — a SECOND call on the Trip
   *  relation's own endpoint, strictly after a successful create, mirroring
   *  the edit modal's save-then-assign ordering. A failure here must not
   *  fail the submit: the flight exists either way, so the user gets a
   *  toast instead of a rolled-back-looking error. */
  const maybeAssignTrip = async (created: Flight | void): Promise<void> => {
    if (!tripId || !created?.id) return;
    try {
      await tripsApi.assignFlights(tripId, { flightIds: [created.id], action: "add" });
    } catch (err) {
      logger.warn("Failed to assign the new flight to the selected trip:", err);
      reportPageError(t("flights:edit.tripAssignFailed"));
    }
  };

  // The four submit paths — save, save-and-return, force, merge — share one
  // runner: one request at a time, and a failure that keeps its key and field
  // (forgejo#246, #247). See useFlightSubmit.ts.
  const submit = useFlightSubmit({
    t,
    departure,
    arrival,
    canSubmit,
    onSubmit,
    buildFlightPayload,
    storeHistoricalData,
    maybeAssignTrip,
    prepareReturnFlightForm,
    afterReturnPrepared: () =>
      useToastStore.getState().addToast("info", t("flights:form.returnFlightHint")),
    prepareNextFlightForm,
    afterNextPrepared: () =>
      useToastStore.getState().addToast("info", t("flights:form.nextFlightHint")),
    setLoading: state.setLoading,
    setError: state.setError,
    setDuplicateFlight: state.setDuplicateFlight,
    setTimeEstimationWarning: state.setTimeEstimationWarning,
  });
  const {
    handleSubmit,
    handleSubmitAndReturn,
    handleSubmitAndNext,
    handleForceSubmit,
    handleMergeSubmit,
  } = submit;

  const review = useFlightReviewConfirm({ s: state, refs, t, onSubmit, onCancel, onBatchComplete });
  const {
    importBatchId: _importBatchId,
    setLookupResults: _setLookupResults,
    setSelectedFlight: _setSelectedFlight,
    ...publicFields
  } = fields;

  return {
    ...publicFields,
    canSubmit,
    // Handlers
    handleFlightLookup: lookup.handleFlightLookup,
    handleSelectFlight: lookup.handleSelectFlight,
    handleBoardingPassScan: lookup.handleBoardingPassScan,
    handleSubmit,
    handleSubmitAndReturn,
    handleSubmitAndNext,
    handleForceSubmit,
    handleMergeSubmit,
    handleFlightReviewConfirm: review.handleFlightReviewConfirm,
    /** The last refused save, with its key and field — or null. */
    submitFailure: submit.failure,
    clearSubmitFailure: submit.clearFailure,
    /** Repeats the save path that failed. */
    retrySubmit: submit.retry,
    savedCount: submit.savedCount,
  };
}

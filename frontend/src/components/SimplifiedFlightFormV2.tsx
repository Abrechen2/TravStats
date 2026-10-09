/**
 * Simplified Flight Form V2
 *
 * Step-by-step guided flight entry form with:
 * - Email/boarding-pass import, flight-number lookup, and manual entry
 * - Auto arrival-time estimation
 * - Duplicate detection with force-submit
 *
 * State & handlers live in FlightForm/useFlightForm.ts
 * Step UIs live in FlightForm/FlightLookupStep, FlightSelectStep, FlightCompleteStep
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import Modal from "./Modal";

import FlightReviewModal from "./FlightReviewModal";
import FlightLookupStep from "./FlightForm/FlightLookupStep";
import FlightSelectStep from "./FlightForm/FlightSelectStep";
import FlightCompleteStep from "./FlightForm/FlightCompleteStep";
import { useFlightForm, type FlightSubmitOptions } from "./FlightForm/useFlightForm";
import { focusFirstMissingRequired } from "./FlightForm/requiredFields";
import { FormErrorBanner, SaveBlockedHint, focusFirstError, useDirtyGuard } from "./form";
import { isTransientSaveError } from "../lib/saveErrorMessage";
import {
  SERVER_TIME_FIELDS,
  actualPairErrors,
  flightCreateGaps,
  flightCreateSnapshot,
} from "./FlightForm/createFormState";
import { FLIGHT_FORM_TOUCH } from "./FlightForm/formTouch";

import type { Flight, FlightInput, UserAchievement } from "../types";
import type { ImportDocument } from "./import/documentHandoff";

interface SimplifiedFlightFormProps {
  /** Returning the created Flight enables the post-create trip assignment
   *  (#199); returning void is still valid and simply skips it. */
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>;
  onCancel: () => void;
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void;
  // When provided, a "Sonder-Flug" card is shown in the lookup step. The
  // parent handles closing this form and opening SpecialFlightModal.
  onPickSpecialFlight?: () => void;
  /** Open straight into the e-mail/PDF uploader (entered from the import hub). */
  /** A document another import dialog handed over as a flight booking (D1). */
  initialDocument?: ImportDocument | null;
}

export default function SimplifiedFlightFormV2({
  onSubmit,
  onCancel,
  onBatchComplete,
  onPickSpecialFlight,
  initialDocument = null,
}: SimplifiedFlightFormProps): JSX.Element {
  const { t } = useTranslation(["flights", "errors", "common"]);

  const form = useFlightForm(onSubmit, onCancel, onBatchComplete);
  // The footer's submit button sits outside the <form>; `form={id}` ties it back.
  const formId = useId();
  const hintId = `${formId}-blocked`;
  const formRef = useRef<HTMLFormElement>(null);
  /** The banner and the form together — where a refused save looks for what to focus. */
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Pattern: "enabled save, a refused click focuses the first gap" — the
   * REFERENCE the other domains copied (forgejo#245). The buttons stay
   * enabled; what is missing is listed beside them, live, without a hover
   * (the `title` that carried it before reached no finger), and a refused
   * click takes the cursor to the first gap.
   */
  const missing = form.step === "complete" ? flightCreateGaps(form, t) : [];

  // Discard guard (forgejo#248). The baseline is taken one render AFTER the
  // mount: the settings effect fills today's date, the base currency and the
  // default category then, and those are not the user's changes.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const snapshot = flightCreateSnapshot(form);
  const { dirty, reset: resetDirty } = useDirtyGuard(snapshot, snapshot, { open: settled });

  // "Speichern & Rückflug" keeps the dialog open on a prepared return leg:
  // the first flight is saved, so the guard starts over from the new form —
  // in the very render that shows the swapped airports (adjusting state to a
  // prop), so not even one render of it asks about a saved flight.
  const [seenSaves, setSeenSaves] = useState(form.savedCount);
  if (form.savedCount !== seenSaves) {
    setSeenSaves(form.savedCount);
    resetDirty(snapshot);
  }

  // A refused save is told where it belongs (forgejo#246): a half-filled
  // actual pair at its missing time once a save was tried, a time the server
  // refused at that time, everything else in the banner. Both last until the
  // next edit.
  const [attempted, setAttempted] = useState(false);
  const failure = form.submitFailure;
  const snapshotKey = JSON.stringify(snapshot);
  // Recorded in the render that first shows a failure (adjusting state to a
  // prop, not an effect), so the message is there from its first paint.
  const [seenFailure, setSeenFailure] = useState(failure);
  const [failedOn, setFailedOn] = useState<string | null>(null);
  if (failure !== seenFailure) {
    setSeenFailure(failure);
    setFailedOn(failure ? snapshotKey : null);
  }
  const failureCurrent = failure !== null && failedOn === snapshotKey;
  const serverTimeField = failure?.field ? SERVER_TIME_FIELDS[failure.field] : undefined;
  const timeErrors = {
    ...(attempted ? actualPairErrors(form, t) : {}),
    ...(failureCurrent && serverTimeField ? { [serverTimeField]: t(failure.key) } : {}),
  };
  const bannerMessage = failure
    ? failureCurrent && !serverTimeField
      ? form.error
      : null
    : form.error || null;

  // After a refusal has rendered, the cursor goes to it: the field, or the banner.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest > 0) focusFirstError(rootRef.current);
  }, [focusRequest]);
  useEffect(() => {
    if (failure) setFocusRequest((n) => n + 1);
  }, [failure]);

  /**
   * A refused save puts the cursor in the first field that is missing
   * (forgejo#88, point 9).
   *
   * The refusal itself is `useFlightForm`'s — it answers with one sentence at
   * the top of the dialog that names no field, which on a form this long means
   * the user scrolls looking for what is empty. Focusing is not a second
   * validation: `canSubmit` is the same guard the hook is about to apply, and
   * when it holds nothing is focused and the submit runs untouched.
   *
   * **Every save path runs it, including both footer buttons.** It used to
   * run on the form's own submit alone, because the two footer buttons were
   * `disabled` while `canSubmit` was false — and the beta audit of 2026-09-19
   * measured what that costs: clearing a required time greys BOTH buttons
   * out, so "the first missing field is focused on a refused save" was
   * unreachable by the only route most users take. A disabled button is a
   * refusal that names nothing and points nowhere.
   *
   * The buttons are now enabled whenever the form is not saving. Pressing one
   * with something missing takes the refusal `useFlightForm` already had
   * (which names the class of problem at the top of the dialog) and adds what
   * it never had: the cursor in the field, with its section unfolded. The
   * hook's own `!canSubmit` guards stay exactly as they were — they are what
   * keeps the refusal real ("canSubmit only greys out the button").
   */
  /** False when the click is refused here — a gap `canSubmit` does not know (a negative amount). */
  const focusFirstGapIfIncomplete = (): boolean => {
    setAttempted(true);
    if (form.canSubmit && missing.length === 0) return true;
    // A required field still empty first; otherwise the first field whose
    // error renders with this click (a half-filled actual pair, an amount).
    if (!focusFirstMissingRequired(formRef.current)) setFocusRequest((n) => n + 1);
    // `canSubmit` failing is still the hook's refusal to make (its banner).
    return !form.canSubmit;
  };

  const handleSubmitWithFocus = (e: React.FormEvent): void => {
    if (!focusFirstGapIfIncomplete()) {
      e.preventDefault();
      return;
    }
    void form.handleSubmit(e);
  };

  const handleSubmitAndReturnWithFocus = (e: React.FormEvent): void => {
    if (!focusFirstGapIfIncomplete()) {
      e.preventDefault();
      return;
    }
    void form.handleSubmitAndReturn(e);
  };

  // Theme classes (dark-only — see TravStatsWeb/brand/BRAND.md §1.1)
  const textClass = "text-white";
  const mutedTextClass = "text-(--text-muted)";
  const sizedInputClass =
    "bg-(--bg-surface) border-border text-white placeholder-(--text-muted) text-base py-3";

  return (
    <>
      {/* The shared frame (CT106 design-6 recheck R01): it was two fixed DIVs
          with no dialog role, so focus stayed on the button behind it, Escape
          did nothing, Tab walked into the page, and "Abbrechen" sat below the
          90vh fold with no close control above it. Modal gives the role, the
          focus trap, Escape for the TOP dialog only, a close button in the
          header and a footer that stays in view while the body scrolls. */}
      <Modal
        open
        onClose={onCancel}
        busy={form.loading}
        // Not before the defaults have landed: an untouched form must not
        // arm the Back guard for one render.
        dirty={settled && dirty}
        title={t("flights:form.title")}
        maxWidth={672}
        closeLabel={t("common:buttons.close")}
        footer={(requestClose) => (
          <>
            {form.step === "complete" && (
              <div className="mr-auto self-center">
                <SaveBlockedHint id={hintId} missing={missing} />
              </div>
            )}
            <button
              type="button"
              onClick={requestClose}
              className="btn-secondary"
              disabled={form.loading}
            >
              {t("flights:form.cancel")}
            </button>
            {form.step === "complete" && (
              <>
                {/* Enabled whenever the form is not saving (beta audit
                    2026-09-19, forgejo#88 P9): a refused click focuses the
                    first gap. What is missing is said beside them, not in a
                    `title` a finger never sees. */}
                <button
                  type="button"
                  onClick={handleSubmitAndReturnWithFocus}
                  className="btn-secondary"
                  disabled={form.loading}
                  aria-describedby={hintId}
                >
                  {t("flights:form.submitAndReturn")}
                </button>
                <button
                  type="submit"
                  form={formId}
                  className="btn-primary"
                  disabled={form.loading}
                  aria-describedby={hintId}
                >
                  {form.loading ? t("flights:form.saving") : t("flights:form.submit")}
                </button>
              </>
            )}
          </>
        )}
      >
        <div ref={rootRef}>
          <p className={`text-sm ${mutedTextClass} mb-2`}>
            {form.step === "input" && t("flights:form.steps.input")}
            {form.step === "select" && t("flights:form.steps.select")}
            {form.step === "complete" && t("flights:form.steps.complete")}
          </p>

          {/* Announced and focusable (forgejo#246); "Erneut versuchen" where
            trying again is the likely cure — it repeats the save that failed. */}
          <FormErrorBanner
            message={bannerMessage}
            onRetry={
              failure && isTransientSaveError(failure.key)
                ? () => void form.retrySubmit()
                : undefined
            }
            retryDisabled={form.loading}
          />

          {/* There was a SECOND banner here, derived from state rather than from
            a refused save: `step === "complete" && no airports`. Measured in
            the browser on the public beta (2.7.0-beta.8): skipping the search
            put the user on the manual step with "Bitte waehle Start- und
            Zielflughafen aus" already in red, before a single field had been
            touched — because entering that step IS the condition it tested.
            The same fact is now carried by the asterisks and the disabled
            button's title, which describe the field instead of accusing the
            user; what is left above is `form.error`, which only a refused
            submit sets. */}

          <form
            id={formId}
            ref={formRef}
            // The form's own rules decide: the browser's bubble for the
            // `required` airport inputs would refuse the primary button before
            // the refusal above could name and focus the gap — in the
            // browser's language, and only for the airports.
            noValidate
            onSubmit={handleSubmitWithFocus}
            className={`space-y-6 pt-2 ${FLIGHT_FORM_TOUCH}`}
          >
            {form.step === "input" && (
              <FlightLookupStep
                flightNumber={form.flightNumber}
                searchDate={form.searchDate}
                loading={form.loading}
                showScanner={form.showScanner}
                sizedInputClass={sizedInputClass}
                setFlightNumber={form.setFlightNumber}
                setSearchDate={form.setSearchDate}
                setShowScanner={form.setShowScanner}
                setStep={form.setStep}
                setError={form.setError}
                handleFlightLookup={form.handleFlightLookup}
                handleBoardingPassScan={form.handleBoardingPassScan}
                setImportBatchId={form.setImportBatchId}
                setParsedFlights={form.setParsedFlights}
                setCurrentFlightIndex={form.setCurrentFlightIndex}
                setParserProvider={form.setParserProvider}
                setOriginalEmailData={form.setOriginalEmailData}
                setShowFlightReview={form.setShowFlightReview}
                onPickSpecialFlight={onPickSpecialFlight}
                initialDocument={initialDocument}
              />
            )}

            {form.step === "select" && form.lookupResults.length > 0 && (
              <FlightSelectStep
                textClass={textClass}
                mutedTextClass={mutedTextClass}
                lookupResults={form.lookupResults}
                handleSelectFlight={form.handleSelectFlight}
                setStep={form.setStep}
              />
            )}

            {form.step === "complete" && (
              <FlightCompleteStep
                textClass={textClass}
                mutedTextClass={mutedTextClass}
                selectedFlight={form.selectedFlight}
                timeEstimationWarning={form.timeEstimationWarning}
                departure={form.departure}
                arrival={form.arrival}
                setDeparture={form.setDeparture}
                setArrival={form.setArrival}
                departureDate={form.departureDate}
                departureTime={form.departureTime}
                arrivalDate={form.arrivalDate}
                arrivalTime={form.arrivalTime}
                setDepartureDate={form.setDepartureDate}
                setDepartureTime={form.setDepartureTime}
                setArrivalDate={form.setArrivalDate}
                setArrivalTime={form.setArrivalTime}
                folds={form.folds}
                setFolds={form.setFolds}
                actualDepartureDate={form.actualDepartureDate}
                actualDepartureTime={form.actualDepartureTime}
                actualArrivalDate={form.actualArrivalDate}
                actualArrivalTime={form.actualArrivalTime}
                setActualDepartureDate={form.setActualDepartureDate}
                setActualDepartureTime={form.setActualDepartureTime}
                setActualArrivalDate={form.setActualArrivalDate}
                setActualArrivalTime={form.setActualArrivalTime}
                airline={form.airline}
                operatingAirline={form.operatingAirline}
                flightNumber={form.flightNumber}
                aircraft={form.aircraft}
                terminal={form.terminal}
                gate={form.gate}
                seatNumber={form.seatNumber}
                seatClass={form.seatClass}
                status={form.status}
                category={form.category}
                setAirline={form.setAirline}
                setOperatingAirline={form.setOperatingAirline}
                setFlightNumber={form.setFlightNumber}
                setAircraft={form.setAircraft}
                setTerminal={form.setTerminal}
                setGate={form.setGate}
                setSeatNumber={form.setSeatNumber}
                boardingGroup={form.boardingGroup}
                setBoardingGroup={form.setBoardingGroup}
                setSeatClass={form.setSeatClass}
                setStatus={form.setStatus}
                setCategory={form.setCategory}
                bookingReference={form.bookingReference}
                ticketNumber={form.ticketNumber}
                bookingClassLetter={form.bookingClassLetter}
                baggageAllowance={form.baggageAllowance}
                frequentFlyerNumber={form.frequentFlyerNumber}
                setBookingReference={form.setBookingReference}
                setTicketNumber={form.setTicketNumber}
                setBookingClassLetter={form.setBookingClassLetter}
                setBaggageAllowance={form.setBaggageAllowance}
                setFrequentFlyerNumber={form.setFrequentFlyerNumber}
                cost={{
                  price: form.price,
                  currency: form.currency,
                  taxes: form.taxes,
                  fees: form.fees,
                  receiptUrl: form.receiptUrl,
                }}
                onCostChange={(v) => {
                  form.setPrice(v.price);
                  form.setCurrency(v.currency);
                  form.setTaxes(v.taxes);
                  form.setFees(v.fees);
                  form.setReceiptUrl(v.receiptUrl);
                }}
                tripId={form.tripId}
                setTripId={form.setTripId}
                tags={form.tags}
                companions={form.companions}
                coPassengers={form.coPassengers}
                setTags={form.setTags}
                setCompanions={form.setCompanions}
                notes={form.notes}
                setNotes={form.setNotes}
                sizedInputClass={sizedInputClass}
                setTimeEstimationWarning={form.setTimeEstimationWarning}
                timeErrors={timeErrors}
              />
            )}
          </form>
        </div>
      </Modal>

      {/* Flight Review Modal (for Email & Boarding Pass) */}
      {form.showFlightReview && form.parsedFlights.length > 0 && (
        <FlightReviewModal
          isOpen={form.showFlightReview}
          onClose={() => {
            form.setShowFlightReview(false);
            form.setParsedFlights([]);
            form.setCurrentFlightIndex(0);
          }}
          onConfirm={form.handleFlightReviewConfirm}
          initialData={form.parsedFlights[form.currentFlightIndex]}
          source="email"
          flightIndex={form.currentFlightIndex}
          totalFlights={form.parsedFlights.length}
          originalData={form.originalEmailData}
        />
      )}

      {/* Duplicate Flight Dialog — the same frame, so Escape closes this
          question and not the form underneath it. */}
      {form.duplicateFlight && (
        <Modal
          open
          onClose={() => form.setDuplicateFlight(null)}
          title={t("flights:form.duplicate.title")}
          maxWidth={448}
          closeLabel={t("common:buttons.close")}
          footer={
            <>
              <button
                type="button"
                onClick={() => form.setDuplicateFlight(null)}
                className="btn-secondary"
              >
                {t("flights:form.duplicate.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void form.handleForceSubmit()}
                className="btn-secondary"
              >
                {t("flights:form.duplicate.addAnyway")}
              </button>
              <button
                type="button"
                onClick={() => void form.handleMergeSubmit()}
                className="btn-primary"
              >
                {t("flights:form.duplicate.merge")}
              </button>
            </>
          }
        >
          <p className="mb-3" style={{ color: "var(--ts-text)" }}>
            {t("flights:form.duplicate.message", {
              flightNumber: form.duplicateFlight!.flightNumber,
              route: `${form.duplicateFlight!.depIata ?? "?"} → ${form.duplicateFlight!.arrIata ?? "?"}`,
            })}
          </p>
          <p className="t-caption">{t("flights:form.duplicate.mergeHint")}</p>
        </Modal>
      )}
    </>
  );
}

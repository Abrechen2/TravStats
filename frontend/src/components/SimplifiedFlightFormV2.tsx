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

import { useId, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import Modal from "./Modal";

import FlightReviewModal from "./FlightReviewModal";
import FlightLookupStep from "./FlightForm/FlightLookupStep";
import FlightSelectStep from "./FlightForm/FlightSelectStep";
import FlightCompleteStep from "./FlightForm/FlightCompleteStep";
import { useFlightForm, type FlightSubmitOptions } from "./FlightForm/useFlightForm";
import { focusFirstMissingRequired } from "./FlightForm/requiredFields";

import type { Flight, FlightInput, UserAchievement } from "../types";

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
}

export default function SimplifiedFlightFormV2({
  onSubmit,
  onCancel,
  onBatchComplete,
  onPickSpecialFlight,
}: SimplifiedFlightFormProps): JSX.Element {
  const { t } = useTranslation(["flights", "errors", "common"]);

  const form = useFlightForm(onSubmit, onCancel, onBatchComplete);
  // The footer's submit button sits outside the <form>; `form={id}` ties it back.
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

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
   * **Only the form's own submit needs this, and that is not an oversight.**
   * Both footer buttons are `disabled` while `canSubmit` is false, so neither
   * can reach a refusal; what can is Enter in any input, which submits the
   * `<form>` past the disabled buttons entirely. That is also the user who
   * needs it most — they never looked at the button, so the greyed-out state
   * told them nothing. `useFlightForm` guards its handlers for exactly the
   * same reason ("canSubmit only greys out the button").
   */
  const handleSubmitWithFocus = (e: React.FormEvent): void => {
    if (!form.canSubmit) focusFirstMissingRequired(formRef.current);
    void form.handleSubmit(e);
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
        title={t("flights:form.title")}
        maxWidth={672}
        closeLabel={t("common:buttons.close")}
        footer={
          <>
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
              disabled={form.loading}
            >
              {t("flights:form.cancel")}
            </button>
            {form.step === "complete" && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    void form.handleSubmitAndReturn(e);
                  }}
                  className={`btn-secondary ${!form.canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}
                  disabled={form.loading || !form.canSubmit}
                  title={
                    !form.canSubmit
                      ? t("flights:form.validation.selectAirportsAndDates")
                      : t("flights:form.submitAndReturn")
                  }
                >
                  {t("flights:form.submitAndReturn")}
                </button>
                <button
                  type="submit"
                  form={formId}
                  className={`btn-primary ${!form.canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}
                  disabled={form.loading || !form.canSubmit}
                  title={
                    !form.canSubmit
                      ? t("flights:form.validation.selectAirportsAndDates")
                      : t("flights:form.submit")
                  }
                >
                  {form.loading ? t("flights:form.saving") : t("flights:form.submit")}
                </button>
              </>
            )}
          </>
        }
      >
        <p className={`text-sm ${mutedTextClass} mb-2`}>
          {form.step === "input" && t("flights:form.steps.input")}
          {form.step === "select" && t("flights:form.steps.select")}
          {form.step === "complete" && t("flights:form.steps.complete")}
        </p>

        {form.error && (
          <div className="mt-2 rounded-sm border px-4 py-3 text-sm" style={ERROR_STYLE}>
            {form.error}
          </div>
        )}

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

        <form id={formId} ref={formRef} onSubmit={handleSubmitWithFocus} className="space-y-6 pt-2">
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
            />
          )}
        </form>
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

const ERROR_STYLE = {
  color: "var(--ts-bad)",
  borderColor: "color-mix(in srgb, var(--ts-bad) 40%, transparent)",
  background: "color-mix(in srgb, var(--ts-bad) 10%, transparent)",
} as const;

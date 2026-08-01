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

import { useTranslation } from "../hooks/useTranslation";

import FlightReviewModal from "./FlightReviewModal";
import FlightLookupStep from "./FlightForm/FlightLookupStep";
import FlightSelectStep from "./FlightForm/FlightSelectStep";
import FlightCompleteStep from "./FlightForm/FlightCompleteStep";
import { useFlightForm, type FlightSubmitOptions } from "./FlightForm/useFlightForm";

import type { FlightInput, UserAchievement } from "../types";

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<void>;
  onCancel: () => void;
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void;
  // When provided, a "Sonder-Flug" card is shown in the lookup step. The
  // parent handles closing this form and opening SpecialFlightModal.
  onPickSpecialFlight?: () => void;
}

export default function SimplifiedFlightFormV2({
  onSubmit,
  onCancel,
  onBatchComplete,
  onPickSpecialFlight,
}: SimplifiedFlightFormProps): JSX.Element {
  const { t } = useTranslation(["flights", "errors", "common"]);

  const form = useFlightForm(onSubmit, onCancel, onBatchComplete);

  // Theme classes (dark-only — see TravStatsWeb/brand/BRAND.md §1.1)
  const bgClass = "bg-(--bg-surface)";
  const textClass = "text-white";
  const mutedTextClass = "text-(--text-muted)";
  const borderClass = "border-border";
  const sizedInputClass =
    "bg-(--bg-surface) border-border text-white placeholder-(--text-muted) text-base py-3";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4">
      <div className={`${bgClass} rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className={`sticky top-0 ${bgClass} border-b ${borderClass} px-6 py-4`}>
          <h2 className={`text-2xl font-bold ${textClass}`}>{t("flights:form.title")}</h2>
          <p className={`text-sm ${mutedTextClass} mt-1`}>
            {form.step === "input" && t("flights:form.steps.input")}
            {form.step === "select" && t("flights:form.steps.select")}
            {form.step === "complete" && t("flights:form.steps.complete")}
          </p>
        </div>

        {form.error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm">
            {form.error}
          </div>
        )}

        {form.step === "complete" && (!form.departure || !form.arrival) && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm">
            {t("errors:missingAirports")}
          </div>
        )}

        <form onSubmit={form.handleSubmit} className="p-6 space-y-6">
          {form.step === "input" && (
            <FlightLookupStep
              flightNumber={form.flightNumber}
              searchDate={form.searchDate}
              loading={form.loading}
              showScanner={form.showScanner}
              showEmailUploader={form.showEmailUploader}
              textClass={textClass}
              mutedTextClass={mutedTextClass}
              bgClass={bgClass}
              sizedInputClass={sizedInputClass}
              setFlightNumber={form.setFlightNumber}
              setSearchDate={form.setSearchDate}
              setShowScanner={form.setShowScanner}
              setShowEmailUploader={form.setShowEmailUploader}
              setStep={form.setStep}
              setError={form.setError}
              handleFlightLookup={form.handleFlightLookup}
              handleBoardingPassScan={form.handleBoardingPassScan}
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
              lookupResults={form.lookupResults}
              textClass={textClass}
              mutedTextClass={mutedTextClass}
              handleSelectFlight={form.handleSelectFlight}
              setStep={form.setStep}
            />
          )}

          {form.step === "complete" && (
            <FlightCompleteStep
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
              price={form.price}
              currency={form.currency}
              setPrice={form.setPrice}
              setCurrency={form.setCurrency}
              tags={form.tags}
              companions={form.companions}
              setTags={form.setTags}
              setCompanions={form.setCompanions}
              notes={form.notes}
              setNotes={form.setNotes}
              textClass={textClass}
              mutedTextClass={mutedTextClass}
              sizedInputClass={sizedInputClass}
              setTimeEstimationWarning={form.setTimeEstimationWarning}
            />
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pt-4 border-t">
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
          </div>
        </form>
      </div>

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

      {/* Duplicate Flight Dialog */}
      {form.duplicateFlight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-(--bg-elevated) border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-(--text-primary) mb-2">
              {t("flights:form.duplicate.title")}
            </h3>
            <p className="text-(--text-secondary) mb-4">
              {t("flights:form.duplicate.message", {
                flightNumber: form.duplicateFlight.flightNumber,
                route: `${form.duplicateFlight.depIata ?? "?"} → ${form.duplicateFlight.arrIata ?? "?"}`,
              })}
            </p>
            <p className="text-xs text-(--text-muted) mb-4">
              {t("flights:form.duplicate.mergeHint")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <button
                type="button"
                onClick={() => form.setDuplicateFlight(null)}
                className="btn-secondary flex-1"
              >
                {t("flights:form.duplicate.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void form.handleMergeSubmit()}
                className="btn-primary flex-1"
              >
                {t("flights:form.duplicate.merge")}
              </button>
              <button
                type="button"
                onClick={() => void form.handleForceSubmit()}
                className="btn-secondary flex-1"
              >
                {t("flights:form.duplicate.addAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

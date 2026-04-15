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

import { useThemeStore } from "../store/themeStore";
import { useTranslation } from "../hooks/useTranslation";

import FlightReviewModal from "./FlightReviewModal";
import FlightLookupStep from "./FlightForm/FlightLookupStep";
import FlightSelectStep from "./FlightForm/FlightSelectStep";
import FlightCompleteStep from "./FlightForm/FlightCompleteStep";
import { useFlightForm } from "./FlightForm/useFlightForm";

import type { FlightInput, UserAchievement } from "../types";

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput, force?: boolean, hasMoreFlights?: boolean) => Promise<void>;
  onCancel: () => void;
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void;
}

export default function SimplifiedFlightFormV2({
  onSubmit,
  onCancel,
  onBatchComplete,
}: SimplifiedFlightFormProps): JSX.Element {
  const { t } = useTranslation(["flights", "errors", "common"]);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  const form = useFlightForm(onSubmit, onCancel, onBatchComplete);

  // Theme classes
  const bgClass = "bg-[var(--bg-surface)]";
  const textClass = isDarkMode ? "text-white" : "text-[var(--text-primary)]";
  const mutedTextClass = "text-[var(--text-muted)]";
  const borderClass = "border-[var(--color-border)]";
  const inputClass = isDarkMode
    ? "bg-[var(--bg-surface)] border-[var(--color-border)] text-white placeholder-[var(--text-muted)]"
    : "bg-[var(--bg-surface)] border-[var(--color-border)] text-[var(--text-primary)]";
  const sizedInputClass = `${inputClass} text-base py-3`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
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
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {form.error}
          </div>
        )}

        {form.step === "complete" && (!form.departure || !form.arrival) && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
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
              isDarkMode={isDarkMode}
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
            />
          )}

          {form.step === "select" && form.lookupResults.length > 0 && (
            <FlightSelectStep
              lookupResults={form.lookupResults}
              isDarkMode={isDarkMode}
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
              price={form.price}
              currency={form.currency}
              setPrice={form.setPrice}
              setCurrency={form.setCurrency}
              tags={form.tags}
              companions={form.companions}
              companionInput={form.companionInput}
              setTags={form.setTags}
              setCompanions={form.setCompanions}
              setCompanionInput={form.setCompanionInput}
              notes={form.notes}
              setNotes={form.setNotes}
              isDarkMode={isDarkMode}
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
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">
              {t("flights:form.duplicate.title")}
            </h3>
            <p className="text-[var(--text-secondary)] mb-4">
              {t("flights:form.duplicate.message", {
                flightNumber: form.duplicateFlight.flightNumber,
                route: `${form.duplicateFlight.depIata ?? "?"} → ${form.duplicateFlight.arrIata ?? "?"}`,
              })}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => form.setDuplicateFlight(null)}
                className="flex-1 px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                {t("flights:form.duplicate.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void form.handleForceSubmit()}
                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
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

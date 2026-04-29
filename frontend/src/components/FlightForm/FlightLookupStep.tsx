import { lazy, Suspense } from "react";
import HelpIcon from "../Help/HelpIcon";
import { useTranslation } from "../../hooks/useTranslation";
import { GlobeLoader } from "../GlobeLoader";
import type { ParsedBooking } from "../../types";
import { isCruiseEmailResult, isCruisePdfResult } from "../../lib/api/parse";

const BoardingPassScanner = lazy(() => import("../BoardingPassScanner"));
const EmailImportTab = lazy(() => import("../import/EmailImportTab"));

export interface FlightLookupStepProps {
  // State
  flightNumber: string;
  searchDate: string;
  loading: boolean;
  showScanner: boolean;
  showEmailUploader: boolean;
  isDarkMode: boolean;
  textClass: string;
  mutedTextClass: string;
  bgClass: string;
  sizedInputClass: string;
  // Setters
  setFlightNumber: (v: string) => void;
  setSearchDate: (v: string) => void;
  setShowScanner: (v: boolean) => void;
  setShowEmailUploader: (v: boolean) => void;
  setStep: (step: "input" | "lookup" | "select" | "complete") => void;
  setError: (msg: string) => void;
  // Handlers
  handleFlightLookup: () => Promise<void>;
  handleBoardingPassScan: (parsedData: ParsedBooking) => Promise<void>;
  setParsedFlights: (flights: ParsedBooking[]) => void;
  setCurrentFlightIndex: (idx: number) => void;
  setParserProvider: (p: string) => void;
  setOriginalEmailData: (
    data: { subject?: string; text?: string; html?: string } | undefined
  ) => void;
  setShowFlightReview: (v: boolean) => void;
}

export default function FlightLookupStep({
  flightNumber,
  searchDate,
  loading,
  showScanner,
  showEmailUploader,
  isDarkMode,
  textClass,
  mutedTextClass,
  bgClass,
  sizedInputClass,
  setFlightNumber,
  setSearchDate,
  setShowScanner,
  setShowEmailUploader,
  setStep,
  setError,
  handleFlightLookup,
  handleBoardingPassScan,
  setParsedFlights,
  setCurrentFlightIndex,
  setParserProvider,
  setOriginalEmailData,
  setShowFlightReview,
}: FlightLookupStepProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  return (
    <div className="space-y-4">
      {/* Email Import - Beste Option */}
      <div
        className={`bg-gradient-to-r ${isDarkMode ? "from-green-900 to-teal-900" : "from-green-50 to-teal-50"} border-2 ${isDarkMode ? "border-green-600 shadow-lg shadow-green-900/50" : "border-green-400 shadow-lg shadow-green-200/50"} rounded-xl p-6 mb-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${isDarkMode ? "hover:shadow-green-900/70" : "hover:shadow-green-300/70"} ${isDarkMode ? "ring-2 ring-green-500/30" : "ring-2 ring-green-400/20"}`}
      >
        <div className="flex items-start gap-4">
          {/* Badge und Icon Bereich */}
          <div className="flex flex-col items-start gap-2 flex-shrink-0">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${isDarkMode ? "bg-yellow-500 text-[var(--text-primary)]" : "bg-yellow-400 text-[var(--text-primary)]"} shadow-md`}
            >
              ⭐ {t("flights:form.email.bestOption")}
            </span>
            <div className={`text-4xl ${isDarkMode ? "text-green-300" : "text-green-600"}`}>📧</div>
          </div>

          {/* Content Bereich */}
          <div className="flex-1 min-w-0">
            <h3 className={`font-bold text-2xl ${textClass} mb-2`}>
              {t("flights:form.email.title")}
            </h3>
            <p
              className={`text-base ${isDarkMode ? mutedTextClass : "text-green-900"} mb-4 font-medium`}
            >
              {t("flights:form.email.description")}
            </p>
            <div className={`space-y-2 mb-4`}>
              <p
                className={`text-sm ${isDarkMode ? "text-green-300" : "text-green-700"} font-semibold flex items-center gap-2`}
              >
                <span className={`text-lg ${isDarkMode ? "text-green-400" : "text-green-600"}`}>
                  ✓
                </span>
                {t("flights:form.email.bestOptionDescription")}
              </p>
            </div>
          </div>

          {/* Button Bereich */}
          <div className="flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowEmailUploader(true)}
              className="btn-primary whitespace-nowrap px-6 py-3 text-base font-semibold flex items-center gap-2 hover:scale-105 transition-transform duration-200 shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              {t("flights:form.email.import")}
            </button>
          </div>
        </div>
      </div>

      {/* Boarding Pass Scanner */}
      <div
        className={`bg-gradient-to-r ${"from-[var(--bg-elevated)] to-[var(--bg-muted)]"} border ${isDarkMode ? "border-blue-700" : "border-blue-200"} rounded-lg p-4`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`font-semibold text-lg ${textClass}`}>
              {t("flights:form.boardingPass.title")}
            </h3>
            <p className={`text-sm ${mutedTextClass}`}>
              {t("flights:form.boardingPass.description")}
            </p>
          </div>
          <button type="button" onClick={() => setShowScanner(true)} className="btn-primary">
            {t("flights:form.boardingPass.scan")}
          </button>
        </div>
      </div>

      {/* Flight Number Input */}
      <div>
        <label className={`label ${textClass} flex items-center gap-2`}>
          {t("flights:form.flightNumber")} {t("flights:form.flightNumberExample")}
          <HelpIcon
            content={t("flights:form.help.flightNumber")}
            expandedContent={t("flights:form.help.flightNumberExpanded")}
            position="top"
          />
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            className={`input flex-1 ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.flightNumber")}
            maxLength={10}
          />
          <input
            type="date"
            value={searchDate}
            onChange={(e) => setSearchDate(e.target.value)}
            className={`input ${sizedInputClass} w-40`}
          />
          <button
            type="button"
            onClick={handleFlightLookup}
            disabled={loading || !flightNumber.trim()}
            className="btn-primary whitespace-nowrap px-6"
          >
            {loading ? t("flights:form.searching") : t("flights:form.searchFlight")}
          </button>
        </div>
        <p className={`text-xs ${mutedTextClass} mt-1`}>{t("flights:form.lookupHint")}</p>
        {flightNumber.trim() && !searchDate && (
          <p className={`text-xs mt-0.5 ${isDarkMode ? "text-yellow-400" : "text-yellow-700"}`}>
            {t("flights:form.dateImproves")}
          </p>
        )}
      </div>

      {/* Manual Entry Option */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => setStep("complete")}
          className={`text-sm ${isDarkMode ? "text-blue-400" : "text-blue-600"} hover:underline`}
        >
          {t("flights:form.manualEntryAction")}
        </button>
      </div>

      {/* Boarding Pass Scanner Modal */}
      {showScanner && (
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-[var(--bg-surface)] rounded-lg p-8">
                <GlobeLoader size={160} label={t("flights:form.loadingScanner")} />
              </div>
            </div>
          }
        >
          <BoardingPassScanner
            onScanSuccess={handleBoardingPassScan}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      {/* Email Uploader Modal */}
      {showEmailUploader && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`${bgClass} rounded-lg p-6 max-w-md w-full mx-4`}>
            <h3 className={`text-xl font-bold ${textClass} mb-4`}>
              {t("flights:form.email.title")}
            </h3>
            <Suspense fallback={<div className="p-6 text-center text-slate-400">Lädt...</div>}>
              <EmailImportTab
                domain="flight"
                acceptedExtensions={[".eml", ".msg", ".txt", ".pdf"]}
                onEmailResult={(result) => {
                  if (isCruiseEmailResult(result)) {
                    setError(t("flights:form.noFlightsInEmail"));
                    return;
                  }
                  const flights: ParsedBooking[] = result.flights ?? [];
                  if (flights.length > 0) {
                    setParsedFlights(flights);
                    setCurrentFlightIndex(0);
                    setParserProvider(result.provider ?? "template");
                    setOriginalEmailData({
                      subject: result.subject,
                      text: result.text,
                      html: result.html,
                    });
                    setShowEmailUploader(false);
                    setShowFlightReview(true);
                  } else {
                    setError(t("flights:form.noFlightsInEmail"));
                  }
                }}
                onPdfResult={(result) => {
                  if (isCruisePdfResult(result)) {
                    setError(t("flights:form.noFlightsInEmail"));
                    return;
                  }
                  if (result.flights.length > 0) {
                    setParsedFlights(result.flights);
                    setCurrentFlightIndex(0);
                    setParserProvider(result.parserUsed ?? "template");
                    setOriginalEmailData(undefined);
                    setShowEmailUploader(false);
                    setShowFlightReview(true);
                  } else {
                    setError(t("flights:form.noFlightsInEmail"));
                  }
                }}
                onError={(message) => {
                  setError(message);
                  setShowEmailUploader(false);
                }}
              />
            </Suspense>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowEmailUploader(false);
                  setError("");
                }}
                className="btn-secondary"
              >
                {t("common:buttons.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

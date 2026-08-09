import { lazy, Suspense } from "react";
import HelpIcon from "../Help/HelpIcon";
import { useTranslation } from "../../hooks/useTranslation";
import { GlobeLoader } from "../GlobeLoader";
import type { ParsedBooking } from "../../types";
import {
  isCruiseEmailResult,
  isCruisePdfResult,
  isLodgingEmailResult,
  isLodgingPdfResult,
} from "../../lib/api/parse";

const BoardingPassScanner = lazy(() => import("../BoardingPassScanner"));
const EmailImportTab = lazy(() => import("../import/EmailImportTab"));

export interface FlightLookupStepProps {
  // State
  flightNumber: string;
  searchDate: string;
  loading: boolean;
  showScanner: boolean;
  showEmailUploader: boolean;
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
  // Optional: launches SpecialFlightModal. When provided, a "Sonder-Flug"
  // card appears below the Boarding Pass card. The parent is responsible
  // for closing this form and opening the special-flight modal.
  onPickSpecialFlight?: () => void;
}

export default function FlightLookupStep({
  flightNumber,
  searchDate,
  loading,
  showScanner,
  showEmailUploader,
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
  onPickSpecialFlight,
}: FlightLookupStepProps): JSX.Element {
  const { t } = useTranslation(["flights", "common", "specialFlights"]);

  return (
    <div className="space-y-4">
      {/* Email Import — "Beste Option" callout. Per BRAND.md §2 recommended /
          preferred callouts use brand amber, not green. */}
      <div
        className="rounded-xl p-6 mb-6 transition-all duration-300 hover:scale-[1.02]"
        style={{
          background: "linear-gradient(to right, var(--accent-soft), rgba(240, 169, 71, 0.04))",
          border: "2px solid var(--accent)",
          boxShadow: "0 8px 24px rgba(240, 169, 71, 0.18)",
        }}
      >
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-start gap-2 shrink-0">
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold shadow-md"
              style={{ background: "var(--accent)", color: "#0d1117" }}
            >
              ⭐ {t("flights:form.email.bestOption")}
            </span>
            <div className="text-4xl" style={{ color: "var(--accent)" }}>
              📧
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className={`font-bold text-2xl ${textClass} mb-2`}>
              {t("flights:form.email.title")}
            </h3>
            <p className={`text-base ${mutedTextClass} mb-4 font-medium`}>
              {t("flights:form.email.description")}
            </p>
            <div className="space-y-2 mb-4">
              <p
                className="text-sm font-semibold flex items-center gap-2"
                style={{ color: "var(--accent)" }}
              >
                <span className="text-lg">✓</span>
                {t("flights:form.email.bestOptionDescription")}
              </p>
            </div>
          </div>

          {/* Button Bereich */}
          <div className="shrink-0">
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

      <div
        className="rounded-lg p-4"
        style={{
          background: "linear-gradient(to right, var(--bg-elevated), var(--bg-muted))",
          border: "1px solid var(--color-border)",
        }}
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

      {/* Special flight — same visual weight as Boarding Pass. Border uses
          flight-domain accent (amber) since Sonder-Flug is a flight subtype,
          not the hotel domain. Per BRAND.md §3: domain colours never bleed
          into other domains. Dark-only (V2). */}
      {onPickSpecialFlight && (
        <div
          className="rounded-lg p-4"
          style={{
            background: "linear-gradient(to right, var(--bg-elevated), var(--bg-muted))",
            border: "1px solid var(--accent)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-2xl">
                ✨
              </span>
              <div>
                <h3 className={`font-semibold text-lg ${textClass}`}>
                  {t("specialFlights:chooser.title")}
                </h3>
                <p className={`text-sm ${mutedTextClass}`}>
                  {t("specialFlights:chooser.description")}
                </p>
              </div>
            </div>
            <button type="button" onClick={onPickSpecialFlight} className="btn-primary">
              {t("specialFlights:chooser.cta")}
            </button>
          </div>
        </div>
      )}

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
          <p className="text-xs mt-0.5 text-yellow-400">{t("flights:form.dateImproves")}</p>
        )}
      </div>

      {/* Manual Entry Option */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => setStep("complete")}
          className="text-sm text-blue-400 hover:underline"
        >
          {t("flights:form.manualEntryAction")}
        </button>
      </div>

      {/* Boarding Pass Scanner Modal */}
      {showScanner && (
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-(--bg-surface) rounded-lg p-8">
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
            <Suspense
              fallback={
                <div className="p-6 text-center text-slate-400">{t("common:buttons.loading")}</div>
              }
            >
              <EmailImportTab
                domain="flight"
                acceptedExtensions={[".eml", ".msg", ".txt", ".pdf"]}
                onEmailResult={(result) => {
                  if (isCruiseEmailResult(result) || isLodgingEmailResult(result)) {
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
                  if (isCruisePdfResult(result) || isLodgingPdfResult(result)) {
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

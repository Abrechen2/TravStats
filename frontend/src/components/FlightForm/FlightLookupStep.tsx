import { lazy, Suspense } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { ImportManualFooter, ImportRouteRow } from "../import/ImportRouteList";
import type { ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
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
  sizedInputClass: string;
  // Setters
  setFlightNumber: (v: string) => void;
  setSearchDate: (v: string) => void;
  setShowScanner: (v: boolean) => void;
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
  sizedInputClass,
  setFlightNumber,
  setSearchDate,
  setShowScanner,
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

  // Lifted out of the old nested modal: the drop zone now sits inline in the
  // first route, so these run in place instead of behind an extra window.
  const handleEmailResult = (result: ParseEmailResult): void => {
    if (isCruiseEmailResult(result) || isLodgingEmailResult(result)) {
      setError(t("flights:form.noFlightsInEmail"));
      return;
    }
    const flights: ParsedBooking[] = result.flights ?? [];
    if (flights.length === 0) {
      setError(t("flights:form.noFlightsInEmail"));
      return;
    }
    setParsedFlights(flights);
    setCurrentFlightIndex(0);
    setParserProvider(result.provider ?? "template");
    setOriginalEmailData({ subject: result.subject, text: result.text, html: result.html });
    setShowFlightReview(true);
  };

  const handlePdfResult = (result: ParsePdfResult): void => {
    if (isCruisePdfResult(result) || isLodgingPdfResult(result)) {
      setError(t("flights:form.noFlightsInEmail"));
      return;
    }
    if (result.flights.length === 0) {
      setError(t("flights:form.noFlightsInEmail"));
      return;
    }
    setParsedFlights(result.flights);
    setCurrentFlightIndex(0);
    setParserProvider(result.parserUsed ?? "template");
    setOriginalEmailData(undefined);
    setShowFlightReview(true);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The three stacked callouts that used to live here — a starred banner,
          a boarding-pass box, a special-flight box — are now the same rows
          every other area uses. Flights had built their own chooser before the
          shared one existed; keeping two meant the wording and the weighting
          drifted apart. The order is the promise: the route that fills in the
          most comes first, typing it out is the footer. */}
      <ImportRouteRow
        primary
        icon="✉️"
        title={t("flights:form.email.title")}
        description={t("flights:form.email.bestOptionDescription")}
      >
        {/* Inline, not behind a button that opens another modal on top of this
            one: the drop zone takes a dragged file, a picked file or pasted
            mail text, and it reads a `.pdf` as readily as an `.eml`. */}
        <div className="mt-3">
          <Suspense
            fallback={
              <div className="p-4 text-center text-sm text-(--text-muted)">
                {t("common:buttons.loading")}
              </div>
            }
          >
            <EmailImportTab
              domain="flight"
              acceptedExtensions={[".eml", ".msg", ".txt", ".pdf"]}
              onEmailResult={handleEmailResult}
              onPdfResult={handlePdfResult}
              onError={(message) => setError(message)}
            />
          </Suspense>
        </div>
      </ImportRouteRow>

      {/* Not "scan": it is a plain file picker (`accept="image/*"`, no
          `capture`), so a screenshot of a phone boarding pass works at the
          desk exactly as a photo does on the phone. The old label promised a
          camera the code never asks for. */}
      <ImportRouteRow
        icon="🎫"
        title={t("flights:form.boardingPass.title")}
        description={t("flights:form.boardingPass.description")}
        actionLabel={t("flights:form.boardingPass.scan")}
        onSelect={() => setShowScanner(true)}
      />

      <ImportRouteRow
        icon="🔎"
        title={t("flights:form.flightNumber")}
        description={t("flights:form.lookupHint")}
      >
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="text"
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            className={`input min-w-28 flex-1 ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.flightNumber")}
            aria-label={t("flights:form.flightNumber")}
            maxLength={10}
          />
          <input
            type="date"
            value={searchDate}
            onChange={(e) => setSearchDate(e.target.value)}
            aria-label={t("flights:form.searchDate")}
            className={`input w-40 ${sizedInputClass}`}
          />
          <button
            type="button"
            onClick={handleFlightLookup}
            disabled={loading || !flightNumber.trim()}
            className="btn-primary whitespace-nowrap px-4"
          >
            {loading ? t("flights:form.searching") : t("flights:form.searchFlight")}
          </button>
        </div>
        {flightNumber.trim() && !searchDate && (
          <p className="mt-1 text-xs text-yellow-400">{t("flights:form.dateImproves")}</p>
        )}
      </ImportRouteRow>

      {onPickSpecialFlight && (
        <ImportRouteRow
          icon="✨"
          title={t("specialFlights:chooser.title")}
          description={t("specialFlights:chooser.description")}
          actionLabel={t("specialFlights:chooser.cta")}
          onSelect={onPickSpecialFlight}
        />
      )}

      <ImportManualFooter
        label={t("flights:form.manualEntryAction")}
        onSelect={() => setStep("complete")}
      />

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

    </div>
  );
}

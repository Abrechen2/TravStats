import { useState, useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useDialogChrome } from "./ui/useDialogChrome";
import type { FlightInput, ParsedBooking } from "../types";
import type { Airport } from "../lib/api";
import { airportResolutionMessage, resolveAirportByCode } from "../lib/airportResolve";
import { useSettingsStore } from "../store/settingsStore";
import { airportZone } from "./FlightForm/flightPayload";
import { MissingZoneError } from "../lib/api/timeInput";
import { flightSaveFailure } from "./FlightForm/flightSaveFailure";
import type { DuplicateFlight } from "./FlightForm/flightFormModel";
import ReviewDuplicateNotice from "./FlightForm/ReviewDuplicateNotice";
import { useTranslation } from "../hooks/useTranslation";
import { RequiredMark } from "./FlightForm/requiredFields";
import { filterEmailText } from "../lib/filterEmailText";
import { getAirlineFromFlightNumber } from "../lib/airlineUtils";
import AirportAutocomplete from "./AirportAutocomplete";
import { useSuggestions } from "../hooks/useSuggestions";
import { useRecentCurrencies } from "../hooks/useRecentCurrencies";
import {
  formatDateTimeLocal,
  getConfidenceColor,
  getFieldBorderClass,
  isInferred,
  mapSeatClass,
} from "../lib/flightReviewFields";
import InferredBadge from "./FlightForm/InferredBadge";
import ReviewCostSection from "./FlightForm/ReviewCostSection";

interface FlightReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (flight: FlightInput) => Promise<void>;
  initialData: ParsedBooking;
  source: "email" | "boardingpass";
  flightIndex?: number;
  totalFlights?: number;
  originalData?: {
    subject?: string;
    text?: string;
    html?: string;
  };
}

export default function FlightReviewModal({
  isOpen,
  onClose,
  onConfirm,
  initialData,
  flightIndex,
  totalFlights,
  originalData,
}: FlightReviewModalProps): JSX.Element | null {
  const { t } = useTranslation(["flights", "common", "errors"]);
  // Every label names its control (forgejo#159 browser check: none did).
  const fieldId = useId();
  const fid = (n: number): string => `${fieldId}-${n}`;
  const { features, baseCurrency } = useSettingsStore();
  const recentCurrencies = useRecentCurrencies();
  const { airlines: airlineSuggestions, aircraft: aircraftSuggestions } = useSuggestions();
  // Form state
  const [flightNumber, setFlightNumber] = useState("");
  const [airline, setAirline] = useState("");
  const [departureCode, setDepartureCode] = useState("");
  const [arrivalCode, setArrivalCode] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [seatClass, setSeatClass] = useState<"economy" | "premium_economy" | "business" | "first">(
    "economy"
  );
  const [seat, setSeat] = useState("");
  const [terminal, setTerminal] = useState("");
  const [gate, setGate] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [boardingGroup, setBoardingGroup] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<string>(baseCurrency || "EUR");
  const [taxes, setTaxes] = useState<number | undefined>(undefined);
  const [fees, setFees] = useState<number | undefined>(undefined);

  // Airport lookup state
  const [departureAirport, setDepartureAirport] = useState<Airport | null>(null);
  const [arrivalAirport, setArrivalAirport] = useState<Airport | null>(null);
  const [airportLoading, setAirportLoading] = useState(false);
  const [airportError, setAirportError] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<DuplicateFlight | null>(null);
  const [showSourceText, setShowSourceText] = useState(false);

  // Initialize form with parsed data
  useEffect(() => {
    if (initialData) {
      // Reset form state when switching to a new flight
      setError("");
      setAirportError("");
      setShowSourceText(false);
      setDepartureAirport(null);
      setArrivalAirport(null);

      setFlightNumber(initialData.flightNumber || "");
      setAirline(initialData.airline || "");
      setDepartureCode(initialData.departureCode || "");
      setArrivalCode(initialData.arrivalCode || "");
      setDepartureTime(
        initialData.departureTime ? formatDateTimeLocal(initialData.departureTime) : ""
      );
      setArrivalTime(initialData.arrivalTime ? formatDateTimeLocal(initialData.arrivalTime) : "");
      setAircraft(initialData.aircraft || "");
      setSeat(initialData.seat || "");
      setTerminal(initialData.terminal || "");
      setGate(initialData.gate || "");
      setBookingReference(initialData.bookingReference || initialData.pnr || "");
      setBoardingGroup(initialData.boardingGroup || "");
      setTicketNumber(initialData.ticketNumber || "");

      // Parse price fields
      if (initialData.price) {
        const priceNum = parseFloat(initialData.price);
        if (!isNaN(priceNum)) setPrice(priceNum);
      } else {
        setPrice(undefined);
      }
      if (initialData.taxes) {
        const taxesNum = parseFloat(initialData.taxes);
        if (!isNaN(taxesNum)) setTaxes(taxesNum);
      } else {
        setTaxes(undefined);
      }
      if (initialData.fees) {
        const feesNum = parseFloat(initialData.fees);
        if (!isNaN(feesNum)) setFees(feesNum);
      } else {
        setFees(undefined);
      }
      if (initialData.currency) {
        setCurrency(initialData.currency.toUpperCase());
      }

      // Map seat class
      const mappedSeatClass = mapSeatClass(initialData.seatClass);
      if (mappedSeatClass) {
        setSeatClass(mappedSeatClass);
      } else {
        setSeatClass("economy");
      }

      // Lookup airports
      if (initialData.departureCode || initialData.arrivalCode) {
        lookupAirports(initialData.departureCode, initialData.arrivalCode);
      }
    }
  }, [initialData, flightIndex]); // Also depend on flightIndex to ensure update when switching flights

  // Format datetime for datetime-local input
  // Resolve airport codes (IATA or ICAO) the way the autocomplete does:
  // `getByCode`. The text search used here before accepted only an exact IATA
  // hit on its first page, so it answered "not found" for codes the
  // autocomplete resolves at once (silent-failure review 2026-09-26, 16).
  const lookupAirports = async (depCode?: string, arrCode?: string): Promise<void> => {
    if (!depCode && !arrCode) return;

    setAirportLoading(true);
    setAirportError("");

    const [dep, arr] = await Promise.all([
      depCode ? resolveAirportByCode(depCode) : Promise.resolve(null),
      arrCode ? resolveAirportByCode(arrCode) : Promise.resolve(null),
    ]);
    if (dep?.kind === "found") setDepartureAirport(dep.airport);
    if (arr?.kind === "found") setArrivalAirport(arr.airport);

    const messages: string[] = [];
    if (dep?.kind === "missing") {
      messages.push(t("flights:review.departureNotFound", { code: dep.code }));
    }
    if (arr?.kind === "missing") {
      messages.push(t("flights:review.arrivalNotFound", { code: arr.code }));
    }
    for (const failed of [dep, arr]) {
      if (failed?.kind === "failed") {
        const { key, params } = airportResolutionMessage(failed);
        messages.push(t(key, params));
      }
    }
    setAirportError(messages.join(", "));
    setAirportLoading(false);
  };

  // Retry airport lookup when codes change
  useEffect(() => {
    if (departureCode && !departureAirport) {
      lookupAirports(departureCode, undefined);
    }
  }, [departureCode]);

  useEffect(() => {
    if (arrivalCode && !arrivalAirport) {
      lookupAirports(undefined, arrivalCode);
    }
  }, [arrivalCode]);

  // Auto-derive airline from flight number prefix when airline field is empty
  useEffect(() => {
    if (flightNumber && !airline) {
      const derived = getAirlineFromFlightNumber(flightNumber);
      if (derived) setAirline(derived);
    }
  }, [flightNumber]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError("");
    setDuplicate(null);

    // Validation
    if (!departureAirport || !arrivalAirport) {
      setError(t("errors:missingAirports"));
      return;
    }

    if (!departureTime || !arrivalTime) {
      setError(t("errors:missingTimes"));
      return;
    }

    setLoading(true);

    try {
      // The airports' own zones, or a refusal (ADR 0002 D2) — no profile/UTC fallback.
      const depTz = airportZone(departureAirport);
      const arrTz = airportZone(arrivalAirport);
      if (!depTz) throw new MissingZoneError("departureLocal");
      if (!arrTz) throw new MissingZoneError("arrivalLocal");

      const flightInput: FlightInput = {
        airline,
        flightNumber,
        aircraft,
        departure: departureAirport,
        arrival: arrivalAirport,
        departureLocal: departureTime,
        depTimezone: depTz,
        arrivalLocal: arrivalTime,
        arrTimezone: arrTz,
        seatNumber: seat || undefined,
        seatClass: seatClass || undefined,
        boardingGroup: boardingGroup || undefined,
        gate: gate || undefined,
        terminal: terminal || undefined,
        bookingReference: bookingReference || undefined,
        ticketNumber: ticketNumber || undefined,
        price,
        currency,
        taxes,
        fees,
        status: new Date(departureTime) < new Date() ? "flown" : "scheduled",
      };

      await onConfirm(flightInput);
      // onConfirm handles closing the modal or moving to next flight
    } catch (err: unknown) {
      // A code becomes a sentence; never the server's English text or axios's.
      // A 409 with the existing flight is not a failure at all (forgejo#159).
      const failure = flightSaveFailure(err, t);
      if (failure.kind === "duplicate") setDuplicate(failure.existing);
      else setError(failure.message);
    } finally {
      setLoading(false);
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);
  useDialogChrome({ open: isOpen, onClose, panelRef, busy: loading });

  if (!isOpen) return null;

  const title = t("flights:review.title");
  const showProgress = totalFlights && totalFlights > 1 && flightIndex !== undefined;
  /**
   * Whether this click WRITES.
   *
   * Forgejo #14: every step of a multi-leg import, the last one included, was
   * labelled "Weiter". The final press created the records and closed the
   * wizard, so nothing on screen distinguished the click that only moves on
   * from the click that commits — the user could not tell which button press
   * was the irreversible one until it had happened.
   */
  const isFinalStep = showProgress && flightIndex! + 1 === totalFlights;

  // Portalled and wired to the shared chrome (CT106 design-6 recheck R01):
  // opened from the flight form, it is the dialog ON TOP, and only a scrim
  // later in the document than the form's answers Escape — so this closes the
  // review and leaves the form underneath open.
  return createPortal(
    <div className="ts-dialog-scrim">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-(--bg-surface) rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto outline-none"
      >
        {/* Header */}
        <div className="sticky top-0 bg-(--bg-surface) border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-(--text-primary)">{title}</h2>
            {showProgress && (
              <p className="text-sm text-(--text-muted) mt-1">
                {t("flights:review.flightIndex", { index: flightIndex! + 1, total: totalFlights })}
              </p>
            )}
            {(initialData.parserTemplate || initialData.parserConfidence !== undefined) && (
              <div
                data-testid="parser-info-row"
                className="flex items-center gap-2 mt-1.5 flex-wrap"
              >
                <span className="text-xs text-(--text-muted) flex items-center gap-1">
                  <span aria-hidden="true">🤖</span>
                  <span>{initialData.parserTemplate ?? t("flights:review.unknownParser")}</span>
                </span>
                {initialData.parserConfidence !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${getConfidenceColor(initialData.parserConfidence)}`}
                  >
                    {initialData.parserConfidence}% {t("flights:review.confidenceLabel")}
                  </span>
                )}
                {originalData?.text && (
                  <button
                    type="button"
                    onClick={() => setShowSourceText((v) => !v)}
                    className="text-xs px-2 py-0.5 rounded-sm border border-border text-(--text-muted) hover:bg-(--bg-elevated) transition-colors"
                  >
                    {showSourceText
                      ? t("flights:review.hideSourceText")
                      : t("flights:review.sourceText")}
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-(--text-muted) hover:bg-(--bg-elevated) rounded-lg transition-colors"
            aria-label={t("common:buttons.close")}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Source text panel */}
        {showSourceText && originalData?.text && (
          <div className="border-b border-border bg-(--bg-elevated) px-6 py-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-(--text-secondary) max-h-48 overflow-y-auto leading-relaxed">
              {filterEmailText(originalData.text)}
            </pre>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {duplicate && <ReviewDuplicateNotice existing={duplicate} onCancel={onClose} />}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {airportError && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800">{airportError}</p>
            </div>
          )}

          {airportLoading && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800">{t("flights:review.loadingAirports")}</p>
            </div>
          )}

          {/* Flight Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={fid(1)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.flightNumber")} <RequiredMark />
                <InferredBadge
                  show={isInferred("flightNumber", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
                id={fid(1)}
                type="text"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                maxLength={10}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("flightNumber", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.flightNumber")}
                required
              />
            </div>

            <div>
              <label
                htmlFor={fid(2)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.airline")}
                <InferredBadge
                  show={isInferred("airline", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
                id={fid(2)}
                type="text"
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.airline")}
                list="airline-suggestions-review"
              />
              <datalist id="airline-suggestions-review">
                {airlineSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Route */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <AirportAutocomplete
                value={departureAirport}
                onChange={(a) => {
                  setDepartureAirport(a);
                  setDepartureCode(a?.iata || a?.icao || "");
                }}
                label={`${t("flights:form.from")}`}
                placeholder={t("flights:form.placeholders.departureAirport")}
                required
              />
            </div>

            <div>
              <AirportAutocomplete
                value={arrivalAirport}
                onChange={(a) => {
                  setArrivalAirport(a);
                  setArrivalCode(a?.iata || a?.icao || "");
                }}
                label={`${t("flights:form.to")}`}
                placeholder={t("flights:form.placeholders.arrivalAirport")}
                required
              />
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={fid(3)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.departureTime")} <RequiredMark />
                <InferredBadge
                  show={isInferred("departureTime", initialData.inferredFields)}
                  hint={t("flights:review.inferredDateHint")}
                />
              </label>
              <input
                id={fid(3)}
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("departureTime", initialData.fieldSources)}`}
                required
              />
            </div>

            <div>
              <label
                htmlFor={fid(4)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.arrivalTime")} <RequiredMark />
                <InferredBadge
                  show={isInferred("arrivalTime", initialData.inferredFields)}
                  hint={t("flights:review.inferredDateHint")}
                />
              </label>
              <input
                id={fid(4)}
                type="datetime-local"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("arrivalTime", initialData.fieldSources)}`}
                required
              />
            </div>
          </div>

          {/* Aircraft and Class */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={fid(5)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.aircraft")}
                <InferredBadge
                  show={isInferred("aircraft", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
                id={fid(5)}
                type="text"
                value={aircraft}
                onChange={(e) => setAircraft(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.aircraft")}
                list="aircraft-suggestions-review"
              />
              <datalist id="aircraft-suggestions-review">
                {aircraftSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor={fid(6)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.seatClass")}
                <InferredBadge
                  show={isInferred("seatClass", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <select
                id={fid(6)}
                value={seatClass}
                onChange={(e) =>
                  setSeatClass(
                    e.target.value as "economy" | "premium_economy" | "business" | "first"
                  )
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
              >
                <option value="economy">{t("flights:seatClass.economy")}</option>
                <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
                <option value="business">{t("flights:seatClass.business")}</option>
                <option value="first">{t("flights:seatClass.first")}</option>
              </select>
            </div>
          </div>

          {/* Seat Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor={fid(7)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.seat")}
              </label>
              <input
                id={fid(7)}
                type="text"
                value={seat}
                onChange={(e) => setSeat(e.target.value.toUpperCase())}
                maxLength={10}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.seat")}
              />
            </div>

            <div>
              <label
                htmlFor={fid(8)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.terminal")}
              </label>
              <input
                id={fid(8)}
                type="text"
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </div>

            <div>
              <label
                htmlFor={fid(9)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.gate")}
              </label>
              <input
                id={fid(9)}
                type="text"
                value={gate}
                onChange={(e) => setGate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.gate")}
              />
            </div>
          </div>

          {/* Booking Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={fid(10)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.bookingReference")}
                <InferredBadge
                  show={isInferred("bookingReference", initialData.inferredFields, ["pnr"])}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
                id={fid(10)}
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("pnr", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.bookingReference")}
                maxLength={6}
              />
            </div>

            <div>
              <label
                htmlFor={fid(11)}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("flights:form.boardingGroup")}
              </label>
              <input
                id={fid(11)}
                type="text"
                value={boardingGroup}
                onChange={(e) => setBoardingGroup(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.boardingGroup")}
                maxLength={3}
              />
            </div>
          </div>

          {/* Ticket Number */}
          <div>
            <label
              htmlFor={fid(12)}
              className="block text-sm font-medium text-(--text-primary) mb-2"
            >
              {t("flights:form.ticketNumber")}
            </label>
            <input
              id={fid(12)}
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
              placeholder={t("flights:form.placeholders.ticketNumber")}
              maxLength={13}
            />
          </div>

          <ReviewCostSection
            price={price}
            onPrice={setPrice}
            currency={currency}
            onCurrency={setCurrency}
            recentCurrencies={recentCurrencies}
            taxes={taxes}
            onTaxes={setTaxes}
            fees={fees}
            onFees={setFees}
            withTaxesAndFees={features.enableCostTracking}
          />

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-(--bg-muted) text-(--text-primary) rounded-lg hover:bg-(--bg-elevated) transition-colors font-semibold"
              disabled={loading}
            >
              {showProgress ? t("common:buttons.cancel") : t("flights:review.discard")}
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={loading || airportLoading || !departureAirport || !arrivalAirport}
            >
              {loading
                ? t("flights:review.saving")
                : isFinalStep
                  ? // Names the write and its size. The intermediate steps only
                    // ACCUMULATE — no request leaves the browser until this one.
                    t("flights:review.importAll", { count: totalFlights! })
                  : showProgress
                    ? t("common:buttons.next")
                    : t("flights:review.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

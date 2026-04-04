import { useState, useEffect } from "react";
import { Airport, FlightInput, ParsedBooking } from "../types";
import { airportsApi, parseApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";

function getFieldBorderClass(
  fieldName: string,
  fieldSources?: ParsedBooking["fieldSources"]
): string {
  if (!fieldSources) return "";
  const source = fieldSources[fieldName as keyof NonNullable<ParsedBooking["fieldSources"]>];
  if (source === "template") return "border-l-4 border-green-500";
  if (source === "llm") return "border-l-4 border-yellow-400";
  if (source === "empty") return "border-l-4 border-red-500";
  return "";
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (confidence >= 40)
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}

interface FlightReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (flight: FlightInput) => Promise<void>;
  initialData: ParsedBooking;
  source: "email" | "boardingpass";
  flightIndex?: number;
  totalFlights?: number;
  parserProvider?: string;
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
  source,
  flightIndex,
  totalFlights,
  parserProvider = "unknown",
  originalData,
}: FlightReviewModalProps): JSX.Element | null {
  const { t } = useTranslation(["flights", "common", "errors"]);
  const { user } = useAuthStore();
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
  const [currency, setCurrency] = useState<"EUR" | "USD" | "GBP" | "CHF">("EUR");
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
        setCurrency(initialData.currency.toUpperCase() as "EUR" | "USD" | "GBP" | "CHF");
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
  const formatDateTimeLocal = (isoString: string): string => {
    try {
      return new Date(isoString).toISOString().slice(0, 16);
    } catch {
      return "";
    }
  };

  // Map parsed seat class to FlightInput format
  const mapSeatClass = (
    seatClass?: string
  ): "economy" | "premium_economy" | "business" | "first" | null => {
    if (!seatClass) return null;
    const lower = seatClass.toLowerCase();
    if (lower.includes("first")) return "first";
    if (lower.includes("business")) return "business";
    if (lower.includes("premium")) return "premium_economy";
    if (lower.includes("economy")) return "economy";
    return null;
  };

  // Lookup airports by IATA code
  const lookupAirports = async (depCode?: string, arrCode?: string): Promise<void> => {
    if (!depCode && !arrCode) return;

    setAirportLoading(true);
    setAirportError("");

    try {
      const errorMessages: string[] = [];

      if (depCode) {
        const depLabel = depCode.toUpperCase();
        const depResults = await airportsApi.search(depLabel);
        const depMatch = depResults.find((a: Airport) => a.iata?.toUpperCase() === depLabel);
        if (depMatch) {
          setDepartureAirport(depMatch);
        } else {
          errorMessages.push(t("flights:review.departureNotFound", { code: depLabel }));
        }
      }

      if (arrCode) {
        const arrLabel = arrCode.toUpperCase();
        const arrResults = await airportsApi.search(arrLabel);
        const arrMatch = arrResults.find((a: Airport) => a.iata?.toUpperCase() === arrLabel);
        if (arrMatch) {
          setArrivalAirport(arrMatch);
        } else {
          errorMessages.push(t("flights:review.arrivalNotFound", { code: arrLabel }));
        }
      }

      if (errorMessages.length > 0) {
        setAirportError(errorMessages.join(", "));
      }
    } catch {
      setAirportError(t("errors:failedToLoadAirport"));
    } finally {
      setAirportLoading(false);
    }
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError("");

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
      const flightInput: FlightInput = {
        airline,
        flightNumber,
        aircraft,
        departure: departureAirport,
        arrival: arrivalAirport,
        departureTime: new Date(departureTime).toISOString(),
        arrivalTime: new Date(arrivalTime).toISOString(),
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

      // Check if data was corrected and collect feedback
      const hasCorrections = checkForCorrections(initialData, flightInput);
      if (hasCorrections && user) {
        // Collect feedback asynchronously (don't await to avoid blocking)
        collectFeedback(initialData, flightInput).catch((err: unknown) => {
          logger.warn("Failed to collect feedback:", err);
        });
      }

      await onConfirm(flightInput);
      // onConfirm handles closing the modal or moving to next flight
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setError(error.response?.data?.error || error.message || t("errors:saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Check if user made corrections to parsed data
  const checkForCorrections = (original: ParsedBooking, corrected: FlightInput): boolean => {
    // Check critical fields
    if (original.flightNumber !== corrected.flightNumber) return true;
    if (original.departureCode !== corrected.departure?.iata) return true;
    if (original.arrivalCode !== corrected.arrival?.iata) return true;
    if (original.departureTime && corrected.departureTime) {
      const origTime = new Date(original.departureTime).getTime();
      const corrTime = new Date(corrected.departureTime).getTime();
      if (Math.abs(origTime - corrTime) > 60000) return true;
    }
    if (original.pnr !== corrected.bookingReference) return true;
    if (original.seat !== corrected.seatNumber) return true;
    return false;
  };

  // Collect feedback for corrections
  const collectFeedback = async (
    original: ParsedBooking,
    corrected: FlightInput
  ): Promise<void> => {
    try {
      const originalResult = [
        {
          flightNumber: original.flightNumber,
          departureCode: original.departureCode,
          arrivalCode: original.arrivalCode,
          departureTime: original.departureTime,
          arrivalTime: original.arrivalTime,
          pnr: original.pnr,
          seat: original.seat,
          gate: original.gate,
          terminal: original.terminal,
          airline: original.airline,
        },
      ];

      const correctedResult = [
        {
          flightNumber: corrected.flightNumber,
          departureCode: corrected.departure?.iata,
          arrivalCode: corrected.arrival?.iata,
          departureTime: corrected.departureTime,
          arrivalTime: corrected.arrivalTime,
          pnr: corrected.bookingReference,
          seat: corrected.seatNumber,
          gate: corrected.gate,
          terminal: corrected.terminal,
          airline: corrected.airline,
        },
      ];

      await parseApi.submitParserCorrection({
        sourceType: source,
        provider: parserProvider,
        originalResult,
        correctedResult,
        originalData,
      });
    } catch (error: unknown) {
      // Silently fail - feedback collection should not break the flow
      logger.warn("Failed to submit parser correction feedback:", error);
    }
  };

  if (!isOpen) return null;

  const title = t("flights:review.title");
  const showProgress = totalFlights && totalFlights > 1 && flightIndex !== undefined;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--bg-surface)] border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
            {showProgress && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {t("flights:review.flightIndex", { index: flightIndex! + 1, total: totalFlights })}
              </p>
            )}
            {(initialData.parserTemplate || initialData.parserConfidence !== undefined) && (
              <div
                data-testid="parser-info-row"
                className="flex items-center gap-2 mt-1.5 flex-wrap"
              >
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
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
                    className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-colors"
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
            className="p-2 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
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
          <div className="border-b border-[var(--color-border)] bg-[var(--bg-elevated)] px-6 py-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-[var(--text-secondary)] max-h-48 overflow-y-auto leading-relaxed">
              {originalData.text}
            </pre>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.flightNumber")} *
              </label>
              <input
                type="text"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value)}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("flightNumber", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.flightNumber")}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.airline")}
              </label>
              <input
                type="text"
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.airline")}
              />
            </div>
          </div>

          {/* Route */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.departureAirportCode")} *
              </label>
              <input
                type="text"
                value={departureCode}
                onChange={(e) => {
                  const code = e.target.value.toUpperCase();
                  setDepartureCode(code);
                  setDepartureAirport(null);
                }}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("departureCode", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.departureCode")}
                maxLength={3}
                required
              />
              {departureAirport && (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t("flights:review.selectedAirport", {
                    name: departureAirport.name,
                    code: departureAirport.iata || departureAirport.icao || "",
                  })}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.arrivalAirportCode")} *
              </label>
              <input
                type="text"
                value={arrivalCode}
                onChange={(e) => {
                  const code = e.target.value.toUpperCase();
                  setArrivalCode(code);
                  setArrivalAirport(null);
                }}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("arrivalCode", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.arrivalCode")}
                maxLength={3}
                required
              />
              {arrivalAirport && (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t("flights:review.selectedAirport", {
                    name: arrivalAirport.name,
                    code: arrivalAirport.iata || arrivalAirport.icao || "",
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.departureTime")} *
              </label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("departureTime", initialData.fieldSources)}`}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.arrivalTime")} *
              </label>
              <input
                type="datetime-local"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("arrivalTime", initialData.fieldSources)}`}
                required
              />
            </div>
          </div>

          {/* Aircraft and Class */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.aircraft")}
              </label>
              <input
                type="text"
                value={aircraft}
                onChange={(e) => setAircraft(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.aircraft")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.seatClass")}
              </label>
              <select
                value={seatClass}
                onChange={(e) =>
                  setSeatClass(
                    e.target.value as "economy" | "premium_economy" | "business" | "first"
                  )
                }
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.seat")}
              </label>
              <input
                type="text"
                value={seat}
                onChange={(e) => setSeat(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.seat")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.terminal")}
              </label>
              <input
                type="text"
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.gate")}
              </label>
              <input
                type="text"
                value={gate}
                onChange={(e) => setGate(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.gate")}
              />
            </div>
          </div>

          {/* Booking Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.bookingReference")}
              </label>
              <input
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                className={`w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("pnr", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.bookingReference")}
                maxLength={6}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("flights:form.boardingGroup")}
              </label>
              <input
                type="text"
                value={boardingGroup}
                onChange={(e) => setBoardingGroup(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.boardingGroup")}
                maxLength={3}
              />
            </div>
          </div>

          {/* Ticket Number */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {t("flights:form.ticketNumber")}
            </label>
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
              placeholder={t("flights:form.placeholders.ticketNumber")}
              maxLength={13}
            />
          </div>

          {/* Cost Breakdown */}
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t("flights:review.costsTitle")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t("common:labels.price")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price || ""}
                  onChange={(e) =>
                    setPrice(e.target.value ? parseFloat(e.target.value) : undefined)
                  }
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                  placeholder={t("flights:form.placeholders.price")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t("flights:form.currency")}
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as "EUR" | "USD" | "GBP" | "CHF")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                >
                  <option value="EUR">{t("flights:currency.EUR")}</option>
                  <option value="USD">{t("flights:currency.USD")}</option>
                  <option value="GBP">{t("flights:currency.GBP")}</option>
                  <option value="CHF">{t("flights:currency.CHF")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t("common:labels.taxes")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={taxes || ""}
                  onChange={(e) =>
                    setTaxes(e.target.value ? parseFloat(e.target.value) : undefined)
                  }
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                  placeholder={t("flights:form.placeholders.taxes")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t("common:labels.fees")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={fees || ""}
                  onChange={(e) => setFees(e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-blue-500"
                  placeholder={t("flights:form.placeholders.fees")}
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-[var(--bg-muted)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-elevated)] transition-colors font-semibold"
              disabled={loading}
            >
              {showProgress ? t("common:buttons.cancel") : t("flights:review.discard")}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || airportLoading || !departureAirport || !arrivalAirport}
            >
              {loading
                ? t("flights:review.saving")
                : showProgress
                  ? t("common:buttons.next")
                  : t("flights:review.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

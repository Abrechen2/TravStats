import { useState, useEffect } from "react";
import type { FlightInput, ParsedBooking } from "../types";
import { type Airport, airportsApi } from "../lib/api";
import { useSettingsStore } from "../store/settingsStore";
import { useTranslation } from "../hooks/useTranslation";
import { filterEmailText } from "../lib/filterEmailText";
import { getAirlineFromFlightNumber } from "../lib/airlineUtils";
import AirportAutocomplete from "./AirportAutocomplete";
import { useSuggestions } from "../hooks/useSuggestions";
import CurrencyInput from "./CurrencyInput";

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

function isInferred(
  fieldName: string,
  inferredFields?: string[],
  aliases: readonly string[] = []
): boolean {
  if (!inferredFields || inferredFields.length === 0) return false;
  if (inferredFields.includes(fieldName)) return true;
  return aliases.some((alias) => inferredFields.includes(alias));
}

interface InferredBadgeProps {
  show: boolean;
  hint: string;
}

function InferredBadge({ show, hint }: InferredBadgeProps): JSX.Element | null {
  if (!show) return null;
  return (
    <span
      className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-yellow-400 text-yellow-900 cursor-help"
      title={hint}
      aria-label={hint}
    >
      !
    </span>
  );
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
  const { features } = useSettingsStore();
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
  const [currency, setCurrency] = useState<string>("EUR");
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
  // Avoid UTC conversion for timezone-naive strings like "2023-10-17T00:00"
  // which would shift the date by the local UTC offset
  const formatDateTimeLocal = (isoString: string): string => {
    const match = isoString.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (match) return `${match[1]}T${match[2]}`;
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
      // Pick IANA tz from the airport record; fall back to user display tz if
      // the airport entry is incomplete. Server converts local + tz → real UTC.
      const userTz = useSettingsStore.getState().display?.timezone || "UTC";
      const depTz = departureAirport.timezone || userTz;
      const arrTz = arrivalAirport.timezone || userTz;

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
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setError(error.response?.data?.error || error.message || t("errors:saveFailed"));
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.flightNumber")} *
                <InferredBadge
                  show={isInferred("flightNumber", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.airline")}
                <InferredBadge
                  show={isInferred("airline", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.departureTime")} *
                <InferredBadge
                  show={isInferred("departureTime", initialData.inferredFields)}
                  hint={t("flights:review.inferredDateHint")}
                />
              </label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("departureTime", initialData.fieldSources)}`}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.arrivalTime")} *
                <InferredBadge
                  show={isInferred("arrivalTime", initialData.inferredFields)}
                  hint={t("flights:review.inferredDateHint")}
                />
              </label>
              <input
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.aircraft")}
                <InferredBadge
                  show={isInferred("aircraft", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.seatClass")}
                <InferredBadge
                  show={isInferred("seatClass", initialData.inferredFields)}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <select
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.seat")}
              </label>
              <input
                type="text"
                value={seat}
                onChange={(e) => setSeat(e.target.value.toUpperCase())}
                maxLength={10}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.seat")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.terminal")}
              </label>
              <input
                type="text"
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.gate")}
              </label>
              <input
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
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.bookingReference")}
                <InferredBadge
                  show={isInferred("bookingReference", initialData.inferredFields, ["pnr"])}
                  hint={t("flights:review.inferredHint")}
                />
              </label>
              <input
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                className={`w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500 ${getFieldBorderClass("pnr", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.bookingReference")}
                maxLength={6}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-2">
                {t("flights:form.boardingGroup")}
              </label>
              <input
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
            <label className="block text-sm font-medium text-(--text-primary) mb-2">
              {t("flights:form.ticketNumber")}
            </label>
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
              placeholder={t("flights:form.placeholders.ticketNumber")}
              maxLength={13}
            />
          </div>

          {/* Cost Breakdown — price + currency always available, matching the
              cruise forms (#192); taxes/fees stay behind cost tracking. */}
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-(--text-primary) mb-3">
              {t("flights:review.costsTitle")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-(--text-primary) mb-2">
                  {t("common:labels.price")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price || ""}
                  onChange={(e) =>
                    setPrice(e.target.value ? parseFloat(e.target.value) : undefined)
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                  placeholder={t("flights:form.placeholders.price")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-(--text-primary) mb-2">
                  {t("flights:form.currency")}
                </label>
                <CurrencyInput
                  value={currency}
                  onChange={setCurrency}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {features.enableCostTracking && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-(--text-primary) mb-2">
                      {t("common:labels.taxes")}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={taxes || ""}
                      onChange={(e) =>
                        setTaxes(e.target.value ? parseFloat(e.target.value) : undefined)
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                      placeholder={t("flights:form.placeholders.taxes")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-(--text-primary) mb-2">
                      {t("common:labels.fees")}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={fees || ""}
                      onChange={(e) =>
                        setFees(e.target.value ? parseFloat(e.target.value) : undefined)
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-blue-500"
                      placeholder={t("flights:form.placeholders.fees")}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

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
    </div>
  );
}

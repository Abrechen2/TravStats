import { useState, useEffect, useRef, useId } from "react";
import Modal from "./Modal";
import {
  FieldError,
  FormErrorBanner,
  RequiredLegend,
  SaveBlockedHint,
  fieldErrorProps,
  useDirtyGuard,
  useFormFailure,
} from "./form";
import { apiErrorMachineCode } from "../lib/apiError";
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import { FLIGHT_FORM_TOUCH } from "./FlightForm/formTouch";
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
import ReviewCostSection from "./FlightForm/ReviewCostSection";
import ReviewField, { REVIEW_INPUT } from "./FlightForm/ReviewField";

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
  const [duplicate, setDuplicate] = useState<DuplicateFlight | null>(null);
  // Which parsed flight the fields were filled from — the discard guard takes
  // its baseline only once they are (forgejo#248).
  const [filledFrom, setFilledFrom] = useState<ParsedBooking | null>(null);
  const [showSourceText, setShowSourceText] = useState(false);

  // Initialize form with parsed data
  useEffect(() => {
    if (initialData) {
      // Reset form state when switching to a new flight
      setFilledFrom(initialData);
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

  // The user-visible, saved fields (forgejo#248). Two of them are filled by
  // the review itself after the parsed values land — the airports' lookup and
  // the airline derived from the flight number — so they are read the way
  // those fill them: the airports by the code a pick also writes, the airline
  // as it will be once derived. Otherwise merely opening a review "changed" it.
  const snapshot = {
    flightNumber,
    airline: airline || getAirlineFromFlightNumber(flightNumber) || "",
    departure: departureCode,
    arrival: arrivalCode,
    departureTime,
    arrivalTime,
    aircraft,
    seatClass,
    seat,
    terminal,
    gate,
    bookingReference,
    boardingGroup,
    ticketNumber,
    price,
    currency,
    taxes,
    fees,
  };
  const settled = isOpen && filledFrom === initialData;
  const { dirty } = useDirtyGuard(snapshot, snapshot, { open: settled });

  /**
   * Pattern: "disabled save + SaveBlockedHint" — the review already greyed
   * out its confirm while an airport was unresolved, and now says why beside
   * it, item by item, live (forgejo#245). The items are the marked fields.
   */
  const formId = useId();
  const hintId = `${formId}-blocked`;
  const ids = {
    flightNumber: fid(1),
    departure: `${fieldId}-departure-airport`,
    arrival: `${fieldId}-arrival-airport`,
    departureTime: fid(3),
    arrivalTime: fid(4),
  };
  const missing = [
    !flightNumber.trim() && { field: ids.flightNumber, label: t("flights:form.flightNumber") },
    !departureAirport && {
      field: ids.departure,
      label: t("flights:form.missing.departureAirport"),
    },
    !arrivalAirport && { field: ids.arrival, label: t("flights:form.missing.arrivalAirport") },
    !departureTime && { field: ids.departureTime, label: t("flights:form.missing.departureTime") },
    !arrivalTime && { field: ids.arrivalTime, label: t("flights:form.missing.arrivalTime") },
  ].filter((step): step is { field: string; label: string } => Boolean(step));
  const failure = useFormFailure(JSON.stringify(snapshot));
  const [serverField, setServerField] = useState<string | null>(null);
  const fieldError = (
    field: "departureLocal" | "arrivalLocal" | "departureAirport" | "arrivalAirport"
  ): string | null => (failure.failureKey && serverField === field ? t(failure.failureKey) : null);
  const fieldFailure = Boolean(
    failure.failureKey &&
    ["departureLocal", "arrivalLocal", "departureAirport", "arrivalAirport"].includes(
      serverField ?? ""
    )
  );
  const inFlight = useRef(false);

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault();
    if (!departureAirport || !arrivalAirport || missing.length > 0) {
      // Enter in a field while something is missing: go to the first gap.
      if (missing.length > 0) document.getElementById(missing[0].field)?.focus();
      return;
    }
    // One request at a time: Enter and a click in one frame both passed the
    // `loading` check, and a single-flight review created the flight twice.
    if (inFlight.current) return;
    inFlight.current = true;
    setDuplicate(null);
    failure.clear();
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
      const outcome = flightSaveFailure(err, t);
      if (outcome.kind === "duplicate") {
        setDuplicate(outcome.existing);
      } else {
        const data = (err as { response?: { data?: { field?: unknown } } } | null)?.response?.data;
        // An airport without a zone belongs at that airport; a refused time
        // at that time.
        const field =
          err instanceof MissingZoneError
            ? err.field === "departureLocal"
              ? "departureAirport"
              : "arrivalAirport"
            : apiErrorMachineCode(err) && typeof data?.field === "string"
              ? data.field
              : null;
        setServerField(field);
        failure.fail(saveErrorKey(err, "errors:saveFailed"));
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

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

  // On the shared frame since forgejo#248 (it was a portal of its own on
  // `useDialogChrome`): the discard question comes with it. Opened from the
  // flight form, it is the dialog ON TOP, so Escape closes the review and
  // leaves the form underneath open.
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      busy={loading}
      dirty={settled && dirty}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      title={
        <span className="flex flex-col">
          <span>{title}</span>
          {showProgress && (
            <span className="text-sm font-normal text-(--text-muted)">
              {t("flights:review.flightIndex", { index: flightIndex! + 1, total: totalFlights })}
            </span>
          )}
        </span>
      }
      footer={(requestClose) => (
        <>
          <div className="mr-auto self-center">
            <SaveBlockedHint id={hintId} missing={missing} />
          </div>
          <button type="button" onClick={requestClose} className="btn-secondary" disabled={loading}>
            {showProgress ? t("common:buttons.cancel") : t("flights:review.discard")}
          </button>
          <button
            type="submit"
            form={formId}
            className="btn-primary"
            disabled={loading || airportLoading || missing.length > 0}
            aria-describedby={hintId}
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
        </>
      )}
    >
      <div ref={failure.rootRef}>
        {(initialData.parserTemplate || initialData.parserConfidence !== undefined) && (
          <div data-testid="parser-info-row" className="flex items-center gap-2 mb-3 flex-wrap">
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
                aria-expanded={showSourceText}
                className="text-xs px-2 py-0.5 rounded-sm border border-border text-(--text-muted) hover:bg-(--bg-elevated) transition-colors pointer-coarse:min-h-(--ts-size-touch-min)"
              >
                {showSourceText
                  ? t("flights:review.hideSourceText")
                  : t("flights:review.sourceText")}
              </button>
            )}
          </div>
        )}

        {showSourceText && originalData?.text && (
          <div className="mb-3 rounded-md border border-border bg-(--bg-elevated) px-4 py-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-(--text-secondary) max-h-48 overflow-y-auto leading-relaxed">
              {filterEmailText(originalData.text)}
            </pre>
          </div>
        )}

        <form
          id={formId}
          onSubmit={(e) => void handleSubmit(e)}
          // The form's own rules decide, at the field (see the create form).
          noValidate
          className={`space-y-4 ${FLIGHT_FORM_TOUCH}`}
        >
          {duplicate && <ReviewDuplicateNotice existing={duplicate} onCancel={onClose} />}
          <FormErrorBanner
            message={failure.failureKey && !fieldFailure ? t(failure.failureKey) : null}
            onRetry={
              failure.failureKey && isTransientSaveError(failure.failureKey)
                ? () => void handleSubmit()
                : undefined
            }
            retryDisabled={loading}
          />

          {airportError && (
            <p role="status" className="rounded-md border p-3 text-sm" style={NOTICE_STYLE}>
              {airportError}
            </p>
          )}

          {airportLoading && (
            <p role="status" className="text-sm text-(--text-muted)">
              {t("flights:review.loadingAirports")}
            </p>
          )}

          {/* Flight Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReviewField
              id={fid(1)}
              label={t("flights:form.flightNumber")}
              required
              inferredHint={
                isInferred("flightNumber", initialData.inferredFields)
                  ? t("flights:review.inferredHint")
                  : null
              }
            >
              <input
                id={fid(1)}
                type="text"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                maxLength={10}
                className={`${REVIEW_INPUT} ${getFieldBorderClass("flightNumber", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.flightNumber")}
                required
              />
            </ReviewField>

            <ReviewField
              id={fid(2)}
              label={t("flights:form.airline")}
              inferredHint={
                isInferred("airline", initialData.inferredFields)
                  ? t("flights:review.inferredHint")
                  : null
              }
            >
              <input
                id={fid(2)}
                type="text"
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.airline")}
                list="airline-suggestions-review"
              />
              <datalist id="airline-suggestions-review">
                {airlineSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </ReviewField>
          </div>

          {/* Route */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <AirportAutocomplete
                id={ids.departure}
                error={fieldError("departureAirport")}
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
                id={ids.arrival}
                error={fieldError("arrivalAirport")}
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
            <ReviewField
              id={fid(3)}
              label={t("flights:form.departureTime")}
              required
              inferredHint={
                isInferred("departureTime", initialData.inferredFields)
                  ? t("flights:review.inferredDateHint")
                  : null
              }
            >
              <input
                id={fid(3)}
                {...fieldErrorProps(fid(3), fieldError("departureLocal"))}
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className={`${REVIEW_INPUT} ${getFieldBorderClass("departureTime", initialData.fieldSources)}`}
                required
              />
              <FieldError id={fid(3)} error={fieldError("departureLocal")} />
            </ReviewField>

            <ReviewField
              id={fid(4)}
              label={t("flights:form.arrivalTime")}
              required
              inferredHint={
                isInferred("arrivalTime", initialData.inferredFields)
                  ? t("flights:review.inferredDateHint")
                  : null
              }
            >
              <input
                id={fid(4)}
                {...fieldErrorProps(fid(4), fieldError("arrivalLocal"))}
                type="datetime-local"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className={`${REVIEW_INPUT} ${getFieldBorderClass("arrivalTime", initialData.fieldSources)}`}
                required
              />
              <FieldError id={fid(4)} error={fieldError("arrivalLocal")} />
            </ReviewField>
          </div>

          {/* Aircraft and Class */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReviewField
              id={fid(5)}
              label={t("flights:form.aircraft")}
              inferredHint={
                isInferred("aircraft", initialData.inferredFields)
                  ? t("flights:review.inferredHint")
                  : null
              }
            >
              <input
                id={fid(5)}
                type="text"
                value={aircraft}
                onChange={(e) => setAircraft(e.target.value)}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.aircraft")}
                list="aircraft-suggestions-review"
              />
              <datalist id="aircraft-suggestions-review">
                {aircraftSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </ReviewField>

            <ReviewField
              id={fid(6)}
              label={t("flights:form.seatClass")}
              inferredHint={
                isInferred("seatClass", initialData.inferredFields)
                  ? t("flights:review.inferredHint")
                  : null
              }
            >
              <select
                id={fid(6)}
                value={seatClass}
                onChange={(e) =>
                  setSeatClass(
                    e.target.value as "economy" | "premium_economy" | "business" | "first"
                  )
                }
                className={REVIEW_INPUT}
              >
                <option value="economy">{t("flights:seatClass.economy")}</option>
                <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
                <option value="business">{t("flights:seatClass.business")}</option>
                <option value="first">{t("flights:seatClass.first")}</option>
              </select>
            </ReviewField>
          </div>

          {/* Seat Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ReviewField id={fid(7)} label={t("flights:form.seat")}>
              <input
                id={fid(7)}
                type="text"
                value={seat}
                onChange={(e) => setSeat(e.target.value.toUpperCase())}
                maxLength={10}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.seat")}
              />
            </ReviewField>

            <ReviewField id={fid(8)} label={t("flights:form.terminal")}>
              <input
                id={fid(8)}
                type="text"
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </ReviewField>

            <ReviewField id={fid(9)} label={t("flights:form.gate")}>
              <input
                id={fid(9)}
                type="text"
                value={gate}
                onChange={(e) => setGate(e.target.value)}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.gate")}
              />
            </ReviewField>
          </div>

          {/* Booking Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReviewField
              id={fid(10)}
              label={t("flights:form.bookingReference")}
              inferredHint={
                isInferred("bookingReference", initialData.inferredFields, ["pnr"])
                  ? t("flights:review.inferredHint")
                  : null
              }
            >
              <input
                id={fid(10)}
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                className={`${REVIEW_INPUT} ${getFieldBorderClass("pnr", initialData.fieldSources)}`}
                placeholder={t("flights:form.placeholders.bookingReference")}
                maxLength={6}
              />
            </ReviewField>

            <ReviewField id={fid(11)} label={t("flights:form.boardingGroup")}>
              <input
                id={fid(11)}
                type="text"
                value={boardingGroup}
                onChange={(e) => setBoardingGroup(e.target.value)}
                className={REVIEW_INPUT}
                placeholder={t("flights:form.placeholders.boardingGroup")}
                maxLength={3}
              />
            </ReviewField>
          </div>

          {/* Ticket Number */}
          <ReviewField id={fid(12)} label={t("flights:form.ticketNumber")}>
            <input
              id={fid(12)}
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className={REVIEW_INPUT}
              placeholder={t("flights:form.placeholders.ticketNumber")}
              maxLength={13}
            />
          </ReviewField>

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

          <RequiredLegend />
        </form>
      </div>
    </Modal>
  );
}

/** A notice, not an error: the warning tone, from the token layer. */
const NOTICE_STYLE = {
  color: "var(--ts-text)",
  borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
  background: "color-mix(in srgb, var(--warning) 12%, transparent)",
} as const;

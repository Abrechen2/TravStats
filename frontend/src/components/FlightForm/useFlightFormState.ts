import { useState } from "react";
import type { Airport } from "../../lib/api";
import type { ParsedBooking } from "../../types";
import type { TimeEstimationWarning } from "./FlightCompleteStep";
import type { FlightLookupResult, DuplicateFlight } from "./flightFormModel";
import type { FlightFolds } from "../../lib/flightFolds";

/*
 * The create form's state, in four slices (forgejo#386 REF-15): UI and the
 * e-mail review, the lookup, the airports and times, and the booking details.
 * `useFlightForm` composes them and owns the effects and handlers.
 */

/** UI State and the e-mail import review. */
function useUiAndReviewState() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicateFlight, setDuplicateFlight] = useState<DuplicateFlight | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [step, setStep] = useState<"input" | "lookup" | "select" | "complete">("input");
  const [timeEstimationWarning, setTimeEstimationWarning] = useState<TimeEstimationWarning | null>(
    null
  );

  // Email Import & Review State
  const [parsedFlights, setParsedFlights] = useState<ParsedBooking[]>([]);
  // The import this review belongs to. Set once when a document is read, so
  // every flight out of the SAME mail lands in one entry in the import log —
  // and can be taken back as one.
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [currentFlightIndex, setCurrentFlightIndex] = useState(0);
  const [showFlightReview, setShowFlightReview] = useState(false);
  const [parserProvider, setParserProvider] = useState<string>("unknown");
  const [originalEmailData, setOriginalEmailData] = useState<
    { subject?: string; text?: string; html?: string } | undefined
  >();
  return {
    loading,
    setLoading,
    error,
    setError,
    duplicateFlight,
    setDuplicateFlight,
    showScanner,
    setShowScanner,
    step,
    setStep,
    timeEstimationWarning,
    setTimeEstimationWarning,
    parsedFlights,
    setParsedFlights,
    importBatchId,
    setImportBatchId,
    currentFlightIndex,
    setCurrentFlightIndex,
    showFlightReview,
    setShowFlightReview,
    parserProvider,
    setParserProvider,
    originalEmailData,
    setOriginalEmailData,
  };
}

/** Flight Lookup State. */
function useLookupState() {
  const [flightNumber, setFlightNumber] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [lookupResults, setLookupResults] = useState<FlightLookupResult[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightLookupResult | null>(null);
  // Lookup-derived metadata persisted on submit but not shown in the form
  // (callsign, tail number, Mode-S from AeroDataBox); editable on the detail view.
  const [lookupCallsign, setLookupCallsign] = useState("");
  const [lookupAircraftRegistration, setLookupAircraftRegistration] = useState("");
  const [lookupAircraftModeS, setLookupAircraftModeS] = useState("");
  const [lookupAirlineIata, setLookupAirlineIata] = useState("");
  const [lookupAirlineIcao, setLookupAirlineIcao] = useState("");
  const [lookupIsCodeshare, setLookupIsCodeshare] = useState<boolean | null>(null);
  return {
    flightNumber,
    setFlightNumber,
    searchDate,
    setSearchDate,
    lookupResults,
    setLookupResults,
    selectedFlight,
    setSelectedFlight,
    // Not part of the hook's public result: the form never shows these.
    meta: {
      lookupCallsign,
      setLookupCallsign,
      lookupAircraftRegistration,
      setLookupAircraftRegistration,
      lookupAircraftModeS,
      setLookupAircraftModeS,
      lookupAirlineIata,
      setLookupAirlineIata,
      lookupAirlineIcao,
      setLookupAirlineIcao,
      lookupIsCodeshare,
      setLookupIsCodeshare,
    },
  };
}

/** Airports, scheduled and actual times, and the status they imply. */
function useTimesState() {
  const [departure, setDeparture] = useState<Airport | null>(null);
  const [arrival, setArrival] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [departureTime, setDepartureTime] = useState("12:00");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("14:00");
  // The later occurrence of a repeated hour, per end (Q5) — see lib/flightFolds.ts.
  const [folds, setFolds] = useState<FlightFolds>({});
  // Actual departure/arrival (#200) — empty by default, not "midday": a new
  // flight has no recorded actual time until the user fills it in.
  const [actualDepartureDate, setActualDepartureDate] = useState("");
  const [actualDepartureTime, setActualDepartureTime] = useState("");
  const [actualArrivalDate, setActualArrivalDate] = useState("");
  const [actualArrivalTime, setActualArrivalTime] = useState("");
  const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
  return {
    departure,
    setDeparture,
    arrival,
    setArrival,
    departureDate,
    setDepartureDate,
    departureTime,
    setDepartureTime,
    arrivalDate,
    setArrivalDate,
    arrivalTime,
    setArrivalTime,
    folds,
    setFolds,
    actualDepartureDate,
    setActualDepartureDate,
    actualDepartureTime,
    setActualDepartureTime,
    actualArrivalDate,
    setActualArrivalDate,
    actualArrivalTime,
    setActualArrivalTime,
    status,
    setStatus,
  };
}

/** Airline, seat, cost and booking details. */
function useDetailsState() {
  const [airline, setAirline] = useState("");
  const [operatingAirline, setOperatingAirline] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [terminal, setTerminal] = useState("");
  const [gate, setGate] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [boardingGroup, setBoardingGroup] = useState("");
  // "" is the "(optional)" choice — submitted as null, stored as NULL, and
  // the INITIAL state (#256): an untouched form must not classify the
  // flight. Only a user-chosen settings default overrides it (effect below).
  const [seatClass, setSeatClass] = useState<
    "" | "economy" | "premium_economy" | "business" | "first"
  >("");
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<string>("EUR");
  const [taxes, setTaxes] = useState<number | undefined>(undefined);
  const [fees, setFees] = useState<number | undefined>(undefined);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [category, setCategory] = useState<"" | "business" | "private" | "vacation">("");
  const [tags, setTags] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [bookingReference, setBookingReference] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [baggageAllowance, setBaggageAllowance] = useState<string | undefined>(undefined);
  const [frequentFlyerNumber, setFrequentFlyerNumber] = useState<string | undefined>(undefined);
  const [bookingClassLetter, setBookingClassLetter] = useState<string | undefined>(undefined);
  const [coPassengers, setCoPassengers] = useState<string[]>([]);
  const [tripId, setTripId] = useState("");
  return {
    airline,
    setAirline,
    operatingAirline,
    setOperatingAirline,
    aircraft,
    setAircraft,
    terminal,
    setTerminal,
    gate,
    setGate,
    seatNumber,
    setSeatNumber,
    boardingGroup,
    setBoardingGroup,
    seatClass,
    setSeatClass,
    notes,
    setNotes,
    price,
    setPrice,
    currency,
    setCurrency,
    taxes,
    setTaxes,
    fees,
    setFees,
    receiptUrl,
    setReceiptUrl,
    category,
    setCategory,
    tags,
    setTags,
    companions,
    setCompanions,
    bookingReference,
    setBookingReference,
    ticketNumber,
    setTicketNumber,
    baggageAllowance,
    setBaggageAllowance,
    frequentFlyerNumber,
    setFrequentFlyerNumber,
    bookingClassLetter,
    setBookingClassLetter,
    coPassengers,
    setCoPassengers,
    tripId,
    setTripId,
  };
}

export function useFlightFormState() {
  return {
    ...useUiAndReviewState(),
    ...useLookupState(),
    ...useTimesState(),
    ...useDetailsState(),
  };
}

export type FlightFormState = ReturnType<typeof useFlightFormState>;

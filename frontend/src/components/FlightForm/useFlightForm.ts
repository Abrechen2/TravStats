import { useState, useEffect, useMemo, useRef } from "react";
import { Airport, airportsApi } from "../../lib/api";
import { flightsApi } from "../../lib/api/flights";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import { storeHistoricalFlightTime, estimateFlightTimes } from "../../lib/timeEstimation";
import type { FlightInput, ParsedBooking, UserAchievement } from "../../types";
import type { TimeEstimationWarning } from "./FlightCompleteStep";

export interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  departure: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  arrival: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  aircraft?: string;
  status?: string;
}

export interface DuplicateFlight {
  id: string;
  flightNumber: string;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: string;
}

export function useFlightForm(
  onSubmit: (flight: FlightInput, force?: boolean, hasMoreFlights?: boolean) => Promise<void>,
  onCancel: () => void,
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void
) {
  const { t } = useTranslation(["flights", "errors"]);
  const settings = useSettingsStore();

  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicateFlight, setDuplicateFlight] = useState<DuplicateFlight | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showEmailUploader, setShowEmailUploader] = useState(false);
  const [step, setStep] = useState<"input" | "lookup" | "select" | "complete">("input");
  const [timeEstimationWarning, setTimeEstimationWarning] = useState<TimeEstimationWarning | null>(
    null
  );

  // Email Import & Review State
  const [parsedFlights, setParsedFlights] = useState<ParsedBooking[]>([]);
  const [currentFlightIndex, setCurrentFlightIndex] = useState(0);
  const [showFlightReview, setShowFlightReview] = useState(false);
  const [parserProvider, setParserProvider] = useState<string>("unknown");
  const [originalEmailData, setOriginalEmailData] = useState<
    { subject?: string; text?: string; html?: string } | undefined
  >();

  // Flight Lookup State
  const [flightNumber, setFlightNumber] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [lookupResults, setLookupResults] = useState<FlightLookupResult[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightLookupResult | null>(null);

  // Form Fields
  const [departure, setDeparture] = useState<Airport | null>(null);
  const [arrival, setArrival] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [departureTime, setDepartureTime] = useState("12:00");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("14:00");
  const [airline, setAirline] = useState("");
  const [operatingAirline, setOperatingAirline] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [terminal, setTerminal] = useState("");
  const [gate, setGate] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [seatClass, setSeatClass] = useState<"economy" | "premium_economy" | "business" | "first">(
    "economy"
  );
  const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<"EUR" | "USD" | "GBP" | "CHF">("EUR");
  const [category, setCategory] = useState<"business" | "private" | "vacation">("business");
  const [tags, setTags] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [companionInput, setCompanionInput] = useState("");
  const [baggageAllowance, setBaggageAllowance] = useState<string | undefined>(undefined);
  const [frequentFlyerNumber, setFrequentFlyerNumber] = useState<string | undefined>(undefined);
  const [bookingClassLetter, setBookingClassLetter] = useState<string | undefined>(undefined);
  const [coPassengers, setCoPassengers] = useState<string[]>([]);

  // Initialize defaults from settings
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    setSearchDate(today);
    setDepartureDate(today);
    setArrivalDate(today);

    if (settings?.units?.currency) setCurrency(settings.units.currency);
    if (settings?.defaults?.flightCategory) setCategory(settings.defaults.flightCategory);
    if (settings?.defaults?.seatClass) setSeatClass(settings.defaults.seatClass);
  }, [settings]);

  // Auto-set status based on date (skip when historical is active)
  useEffect(() => {
    if (status === "historical") return;
    if (departureDate) {
      const depDate = new Date(departureDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setStatus(depDate < today ? "flown" : "scheduled");
    }
  }, [departureDate]);

  // Clear error when step changes
  useEffect(() => {
    setError("");
  }, [step]);

  // Track if arrival date has been set manually
  const arrivalDateSetRef = useRef(false);

  // Accumulates confirmed flight inputs during multi-flight email import
  const confirmedFlightsRef = useRef<FlightInput[]>([]);

  // Reset accumulated flights whenever a new email import session begins
  useEffect(() => {
    confirmedFlightsRef.current = [];
  }, [parsedFlights]);

  // Auto-suggest arrival time based on estimated flight duration
  useEffect(() => {
    if (departureDate && departureTime && departure && arrival && !arrivalDateSetRef.current) {
      try {
        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        depDateTime.setMinutes(depDateTime.getMinutes() - 30);
        const boardingTime = `${String(depDateTime.getHours()).padStart(2, "0")}:${String(depDateTime.getMinutes()).padStart(2, "0")}`;

        const estimation = estimateFlightTimes(
          boardingTime,
          departureDate,
          flightNumber || undefined,
          departure.iata || "",
          arrival.iata || "",
          departure.lat,
          departure.lon,
          arrival.lat,
          arrival.lon
        );

        setArrivalDate(departureDate);
        setArrivalTime(estimation.arrivalTime);
        arrivalDateSetRef.current = true;
        setTimeEstimationWarning({
          show: true,
          source: estimation.source,
          confidence: estimation.confidence,
          sampleCount: estimation.sampleCount,
        });
      } catch {
        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        const arrDateTime = new Date(depDateTime.getTime() + 2 * 60 * 60 * 1000);
        setArrivalDate(arrDateTime.toISOString().split("T")[0]);
        setArrivalTime(arrDateTime.toTimeString().slice(0, 5));
        arrivalDateSetRef.current = true;
        setTimeEstimationWarning({ show: true, source: "heuristic", confidence: "low" });
      }
    }
  }, [departureDate, departureTime, departure, arrival, flightNumber]);

  // Flight Lookup Handler
  const handleFlightLookup = async () => {
    if (!flightNumber.trim()) {
      setError(t("errors:noFlightNumber"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/flight-lookup/${flightNumber}?date=${searchDate}`);
      const data = await response.json();
      if (!data.success || !data.flights || data.flights.length === 0) {
        setError(t("errors:noFlightsFound"));
        setStep("complete");
        return;
      }
      setLookupResults(data.flights);
      setStep("select");
    } catch (err) {
      logger.error("Flight lookup error:", err);
      setError(`${t("errors:lookupUnavailable")} ${t("errors:apiKeyInfo")}`);
      setStep("complete");
    } finally {
      setLoading(false);
    }
  };

  // Select Flight from Lookup Results
  const handleSelectFlight = async (flight: FlightLookupResult) => {
    setSelectedFlight(flight);
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        flight.departure.iata
          ? airportsApi.getByCode(flight.departure.iata)
          : Promise.resolve(null),
        flight.arrival.iata ? airportsApi.getByCode(flight.arrival.iata) : Promise.resolve(null),
      ]);

      const depAirport = results[0].status === "fulfilled" ? results[0].value : null;
      const arrAirport = results[1].status === "fulfilled" ? results[1].value : null;

      if (depAirport) setDeparture(depAirport);
      if (arrAirport) setArrival(arrAirport);

      setAirline(flight.airline);
      setOperatingAirline("");
      setAircraft(flight.aircraft || "");
      setTerminal(flight.departure.terminal || "");
      setGate(flight.departure.gate || "");

      const applyDateTime = (
        value?: string,
        setters?: { setDate: (v: string) => void; setTime: (v: string) => void },
        useSearchDate?: boolean
      ) => {
        if (!value || !setters) return;
        const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2})?/);
        if (match) {
          if (match[1] && !useSearchDate) setters.setDate(match[1]);
          if (match[2]) setters.setTime(match[2]);
          return;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          if (!useSearchDate) setters.setDate(parsed.toISOString().split("T")[0]);
          setters.setTime(parsed.toTimeString().slice(0, 5));
        }
      };

      if (searchDate) {
        setDepartureDate(searchDate);
        applyDateTime(
          flight.departure.scheduledTime,
          { setDate: () => {}, setTime: setDepartureTime },
          true
        );
      } else {
        applyDateTime(flight.departure.scheduledTime, {
          setDate: setDepartureDate,
          setTime: setDepartureTime,
        });
      }

      applyDateTime(flight.arrival.scheduledTime, {
        setDate: setArrivalDate,
        setTime: setArrivalTime,
      });

      if (searchDate && flight.departure.scheduledTime && flight.arrival.scheduledTime) {
        const depTime = new Date(flight.departure.scheduledTime);
        const arrTime = new Date(flight.arrival.scheduledTime);
        const duration = arrTime.getTime() - depTime.getTime();
        const newDepTime = new Date(`${searchDate}T${departureTime || "00:00"}`);
        const newArrTime = new Date(newDepTime.getTime() + duration);
        setArrivalDate(newArrTime.toISOString().split("T")[0]);
        setArrivalTime(newArrTime.toTimeString().slice(0, 5));
      }

      setStep("complete");
    } catch {
      setError(t("errors:failedToLoadAirport"));
    } finally {
      setLoading(false);
    }
  };

  // Boarding Pass Scanner
  const handleBoardingPassScan = async (parsedData: ParsedBooking) => {
    setShowScanner(false);
    setError("");
    setParsedFlights([parsedData]);
    setCurrentFlightIndex(0);
    setShowFlightReview(true);
  };

  // Live validation
  const canSubmit = useMemo(
    () =>
      status === "historical"
        ? !!(departure && arrival)
        : !!(departure && arrival && departureDate && arrivalDate),
    [departure, arrival, departureDate, arrivalDate, status]
  );

  const buildFlightPayload = (): FlightInput => ({
    departure: {
      iata: departure!.iata,
      icao: departure!.icao,
      name: departure!.name,
      lat: departure!.lat,
      lon: departure!.lon,
    },
    arrival: {
      iata: arrival!.iata,
      icao: arrival!.icao,
      name: arrival!.name,
      lat: arrival!.lat,
      lon: arrival!.lon,
    },
    airline: airline || undefined,
    operatingAirline: operatingAirline || undefined,
    flightNumber: flightNumber || undefined,
    aircraft: aircraft || undefined,
    seatClass: seatClass || undefined,
    seatNumber: seatNumber || undefined,
    terminal: terminal || undefined,
    gate: gate || undefined,
    departureTime: !departureDate
      ? undefined
      : status === "historical"
        ? new Date(`${departureDate}T00:00:00`).toISOString()
        : new Date(`${departureDate}T${departureTime}:00`).toISOString(),
    arrivalTime: !arrivalDate
      ? undefined
      : status === "historical"
        ? new Date(`${arrivalDate}T00:00:00`).toISOString()
        : new Date(`${arrivalDate}T${arrivalTime}:00`).toISOString(),
    status,
    notes: notes || undefined,
    price,
    currency,
    category,
    tags: tags.length ? tags : undefined,
    companions: companions.length ? companions : undefined,
    baggageAllowance,
    frequentFlyerNumber,
    bookingClassLetter,
    coPassengers: coPassengers.length ? coPassengers : undefined,
  });

  const storeHistoricalData = () => {
    if (flightNumber && departureTime && arrivalTime && departure?.iata && arrival?.iata) {
      const depDate = new Date(`${departureDate}T${departureTime}`);
      depDate.setMinutes(depDate.getMinutes() - 30);
      const estimatedBoardingTime = `${String(depDate.getHours()).padStart(2, "0")}:${String(depDate.getMinutes()).padStart(2, "0")}`;
      storeHistoricalFlightTime(
        flightNumber,
        departure.iata,
        arrival.iata,
        estimatedBoardingTime,
        departureTime,
        arrivalTime,
        departureDate
      );
    }
  };

  /**
   * After a successful save, prepare the form for entering the return leg:
   * swaps departure/arrival airports, keeps trip-stable fields (airline,
   * category, tags, companions, booking ref via notes) and clears
   * leg-specific ones (flight number, seat, gate, terminal, aircraft,
   * times). The user must pick new dates and times.
   */
  const prepareReturnFlightForm = (): void => {
    const outboundDeparture = departure;
    const outboundArrival = arrival;
    setDeparture(outboundArrival);
    setArrival(outboundDeparture);

    setFlightNumber("");
    setAircraft("");
    setTerminal("");
    setGate("");
    setSeatNumber("");
    setNotes("");
    setOperatingAirline("");

    // Default the new departure date to the original arrival date, time empty —
    // user usually picks both. For a same-day return this is what they want;
    // for a multi-day trip they bump the date forward.
    if (arrivalDate) {
      setDepartureDate(arrivalDate);
      setArrivalDate(arrivalDate);
    }
    setDepartureTime("12:00");
    setArrivalTime("14:00");
    arrivalDateSetRef.current = false;

    setStep("complete");
    setError("");
    setTimeEstimationWarning(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departure || !arrival) {
      setError(t("errors:missingAirports"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      storeHistoricalData();
      setTimeEstimationWarning(null);
      await onSubmit(buildFlightPayload());
    } catch (err: unknown) {
      const errorObj = err as {
        response?: {
          status?: number;
          data?: {
            error?: string;
            details?: { field: string; message: string }[];
            existingFlight?: DuplicateFlight;
          };
        };
      };
      if (errorObj.response?.status === 409 && errorObj.response.data?.existingFlight) {
        setDuplicateFlight(errorObj.response.data.existingFlight);
        setLoading(false);
        return;
      }
      const details = errorObj.response?.data?.details;
      const msg = details?.length
        ? details.map((d) => d.message).join("; ")
        : (errorObj.response?.data?.error ?? t("errors:saveFailed"));
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Save the current flight, then immediately prepare the form for a return
   * leg. Passes hasMoreFlights=true so the parent keeps the modal open.
   */
  const handleSubmitAndReturn = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!departure || !arrival) {
      setError(t("errors:missingAirports"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      storeHistoricalData();
      setTimeEstimationWarning(null);
      await onSubmit(buildFlightPayload(), false, true);
      prepareReturnFlightForm();
      useToastStore.getState().addToast("info", t("flights:form.returnFlightHint"));
    } catch (err: unknown) {
      const errorObj = err as {
        response?: {
          status?: number;
          data?: {
            error?: string;
            details?: { field: string; message: string }[];
            existingFlight?: DuplicateFlight;
          };
        };
      };
      if (errorObj.response?.status === 409 && errorObj.response.data?.existingFlight) {
        setDuplicateFlight(errorObj.response.data.existingFlight);
        return;
      }
      const details = errorObj.response?.data?.details;
      const msg = details?.length
        ? details.map((d) => d.message).join("; ")
        : (errorObj.response?.data?.error ?? t("errors:saveFailed"));
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForceSubmit = async (): Promise<void> => {
    setDuplicateFlight(null);
    if (!departure || !arrival) {
      setError(t("errors:missingAirports"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      storeHistoricalData();
      setTimeEstimationWarning(null);
      await onSubmit(buildFlightPayload(), true);
    } catch (err: unknown) {
      const errorObj = err as {
        response?: { data?: { error?: string; details?: { field: string; message: string }[] } };
      };
      const details = errorObj.response?.data?.details;
      const msg = details?.length
        ? details.map((d) => d.message).join("; ")
        : (errorObj.response?.data?.error ?? t("errors:saveFailed"));
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleFlightReviewConfirm = async (flightData: FlightInput) => {
    const sourceFlight = parsedFlights[currentFlightIndex];
    setBaggageAllowance(sourceFlight?.baggageAllowance);
    setFrequentFlyerNumber(sourceFlight?.frequentFlyerNumber);
    setBookingClassLetter(sourceFlight?.bookingClassLetter);
    setCoPassengers(sourceFlight?.coPassengers ?? []);

    const enrichedFlight: FlightInput = {
      ...flightData,
      baggageAllowance: sourceFlight?.baggageAllowance,
      frequentFlyerNumber: sourceFlight?.frequentFlyerNumber,
      bookingClassLetter: sourceFlight?.bookingClassLetter,
      coPassengers: sourceFlight?.coPassengers,
      // Propagate PNR from parsed email so backend can group flights into Trip+Booking
      bookingReference:
        sourceFlight?.bookingReference ?? sourceFlight?.pnr ?? flightData.bookingReference,
    };

    const nextIndex = currentFlightIndex + 1;
    const hasMoreFlights = nextIndex < parsedFlights.length;
    const isMultiFlight = parsedFlights.length > 1;

    if (isMultiFlight) {
      // Accumulate and send as batch on last flight
      confirmedFlightsRef.current = [...confirmedFlightsRef.current, enrichedFlight];

      if (hasMoreFlights) {
        // Advance to next flight without calling API yet
        setCurrentFlightIndex(nextIndex);
      } else {
        // Last flight — send the whole batch
        setLoading(true);
        setError("");
        try {
          const batchResult = await flightsApi.createBatch(confirmedFlightsRef.current);
          confirmedFlightsRef.current = [];
          setShowFlightReview(false);
          setParsedFlights([]);
          setCurrentFlightIndex(0);
          onBatchComplete?.(batchResult.newAchievements);
          onCancel();
        } catch (err: unknown) {
          const errorObj = err as { response?: { data?: { error?: string }; status?: number } };
          const msg = errorObj.response?.data?.error ?? t("errors:saveFailed");
          // Show as toast since the form may already be closing
          useToastStore.getState().addToast("error", msg);
          setError(msg);
        } finally {
          setLoading(false);
        }
      }
    } else {
      // Single flight — use the existing onSubmit callback
      await onSubmit(enrichedFlight, false, hasMoreFlights);

      if (hasMoreFlights) {
        setCurrentFlightIndex(nextIndex);
      } else {
        setShowFlightReview(false);
        setParsedFlights([]);
        setCurrentFlightIndex(0);
        onCancel();
      }
    }
  };

  return {
    // UI state
    loading,
    error,
    duplicateFlight,
    showScanner,
    showEmailUploader,
    step,
    timeEstimationWarning,
    // Email/review state
    parsedFlights,
    currentFlightIndex,
    showFlightReview,
    parserProvider,
    originalEmailData,
    // Lookup state
    flightNumber,
    searchDate,
    lookupResults,
    selectedFlight,
    // Form fields
    departure,
    arrival,
    departureDate,
    departureTime,
    arrivalDate,
    arrivalTime,
    airline,
    operatingAirline,
    aircraft,
    terminal,
    gate,
    seatNumber,
    seatClass,
    status,
    notes,
    price,
    currency,
    category,
    tags,
    companions,
    companionInput,
    canSubmit,
    // Setters
    setLoading,
    setError,
    setDuplicateFlight,
    setShowScanner,
    setShowEmailUploader,
    setStep,
    setTimeEstimationWarning,
    setParsedFlights,
    setCurrentFlightIndex,
    setShowFlightReview,
    setParserProvider,
    setOriginalEmailData,
    setFlightNumber,
    setSearchDate,
    setDeparture,
    setArrival,
    setDepartureDate,
    setDepartureTime,
    setArrivalDate,
    setArrivalTime,
    setAirline,
    setOperatingAirline,
    setAircraft,
    setTerminal,
    setGate,
    setSeatNumber,
    setSeatClass,
    setStatus,
    setNotes,
    setPrice,
    setCurrency,
    setCategory,
    setTags,
    setCompanions,
    setCompanionInput,
    // Handlers
    handleFlightLookup,
    handleSelectFlight,
    handleBoardingPassScan,
    handleSubmit,
    handleSubmitAndReturn,
    handleForceSubmit,
    handleFlightReviewConfirm,
  };
}

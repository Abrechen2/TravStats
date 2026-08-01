import { useState, useEffect, useMemo, useRef } from "react";
import { Airport, airportsApi } from "../../lib/api";
import { flightsApi } from "../../lib/api/flights";
import { tripsApi } from "../../lib/api/trips";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import { storeHistoricalFlightTime, estimateFlightTimes } from "../../lib/timeEstimation";
import type { Flight, FlightInput, ParsedBooking, UserAchievement } from "../../types";
import type { TimeEstimationWarning } from "./FlightCompleteStep";

export interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  /** Operating airline if the searched flight number is a marketing codeshare. */
  operatingAirline?: string;
  /** True if the API flagged the entry as `IsCodeshare`. */
  isCodeshare?: boolean;
  /** ATC callsign, e.g. "DLH400". AeroDataBox-only. */
  callsign?: string;
  /** Airline IATA code, e.g. "LH". AeroDataBox-only. */
  airlineIata?: string;
  /** Airline ICAO code, e.g. "DLH". AeroDataBox-only. */
  airlineIcao?: string;
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
  /** Tail number / aircraft registration, e.g. "D-AIHX". AeroDataBox-only. */
  aircraftRegistration?: string;
  /** Mode-S transponder hex, e.g. "3C6518". AeroDataBox-only. */
  aircraftModeS?: string;
  /** Great-circle route distance in km from the provider. */
  distance?: number;
  /** Hint to set status to `'cancelled'` or `'diverted'`. AeroDataBox-only. */
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

export interface FlightSubmitOptions {
  force?: boolean;
  merge?: boolean;
  hasMoreFlights?: boolean;
}

// Resolve a historical date string (YYYY / YYYY-MM / YYYY-MM-DD) plus an
// optional HH:mm time into the canonical local-wall-clock submit shape.
// Year-only  -> YYYY-01-01T00:00
// Year+Month -> YYYY-MM-01T00:00
// Year+Month+Day -> YYYY-MM-DDT<time|12:00>
// Everything else falls through to the original YYYY-MM-DDT<time> path.
//
// Module-level (not a hook-local closure) and exported so every submit path
// that recombines a split date+time pair (e.g. FlightEditModal) reuses this
// exact implementation instead of writing a second one — two
// implementations of this is precisely how the create and edit forms
// drifted apart before the edit form's inputs were split to match.
export function buildLocalString(date: string, time: string): string {
  if (/^\d{4}$/.test(date)) {
    return `${date}-01-01T00:00`;
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    return `${date}-01T00:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${date}T${time || "12:00"}`;
  }
  return `${date}T${time}`;
}

export function useFlightForm(
  // Returning the created Flight is what makes the post-create trip
  // assignment possible; `void` keeps older callers valid (they simply get
  // no assignment).
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>,
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
  // Actual departure/arrival (#200) — empty by default: a freshly created
  // flight has no recorded actual time until the user (or live tracking,
  // out of scope here) fills it in. Kept empty rather than defaulted like
  // departureTime/arrivalTime above, since "no value yet" must stay
  // distinguishable from "midday" — see buildFlightPayload below.
  const [actualDepartureDate, setActualDepartureDate] = useState("");
  const [actualDepartureTime, setActualDepartureTime] = useState("");
  const [actualArrivalDate, setActualArrivalDate] = useState("");
  const [actualArrivalTime, setActualArrivalTime] = useState("");
  const [airline, setAirline] = useState("");
  const [operatingAirline, setOperatingAirline] = useState("");
  const [aircraft, setAircraft] = useState("");
  // Lookup-derived metadata that is persisted on submit but not directly
  // surfaced in the form UI: callsign + tail number / Mode-S identifiers
  // come from AeroDataBox automatically and only appear in the flight
  // detail view post-save. The user can still edit them later.
  const [lookupCallsign, setLookupCallsign] = useState("");
  const [lookupAircraftRegistration, setLookupAircraftRegistration] = useState("");
  const [lookupAircraftModeS, setLookupAircraftModeS] = useState("");
  const [lookupAirlineIata, setLookupAirlineIata] = useState("");
  const [lookupAirlineIcao, setLookupAirlineIcao] = useState("");
  const [lookupIsCodeshare, setLookupIsCodeshare] = useState<boolean | null>(null);
  const [terminal, setTerminal] = useState("");
  const [gate, setGate] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [seatClass, setSeatClass] = useState<"economy" | "premium_economy" | "business" | "first">(
    "economy"
  );
  const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<string>("EUR");
  const [taxes, setTaxes] = useState<number | undefined>(undefined);
  const [fees, setFees] = useState<number | undefined>(undefined);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [category, setCategory] = useState<"business" | "private" | "vacation">("business");
  const [tags, setTags] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [bookingReference, setBookingReference] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [baggageAllowance, setBaggageAllowance] = useState<string | undefined>(undefined);
  const [frequentFlyerNumber, setFrequentFlyerNumber] = useState<string | undefined>(undefined);
  const [bookingClassLetter, setBookingClassLetter] = useState<string | undefined>(undefined);
  const [coPassengers, setCoPassengers] = useState<string[]>([]);
  const [tripId, setTripId] = useState("");

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
        // Stay on the input step so the error stays visible — the `step`
        // useEffect clears errors on every transition, so jumping to
        // "complete" here would drop the user into manual entry with no
        // indication of what went wrong (issue #82 follow-up).
        if (data?.error === "LOOKUP_UNAVAILABLE") {
          setError(t("errors:lookupOutsideLiveWindow"));
        } else if (data?.error === "NO_FLIGHT_DATA_API_GAP") {
          setError(t("errors:noFlightDataApiGap"));
        } else if (data?.error === "NO_FLIGHT_DATA_FOR_DATE") {
          setError(t("errors:noFlightDataForDate"));
        } else {
          setError(t("errors:noFlightsFound"));
        }
        return;
      }
      setLookupResults(data.flights);
      setStep("select");
    } catch (err) {
      logger.error("Flight lookup error:", err);
      setError(`${t("errors:lookupUnavailable")} ${t("errors:apiKeyInfo")}`);
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
      // Codeshare path: API marks the searched flight number as marketed
      // by airline X but operated by airline Y. Surface Y as the operating
      // carrier so stats can group on the real metal. For non-codeshare
      // entries (most lookups), leave operatingAirline empty.
      setOperatingAirline(flight.isCodeshare ? flight.operatingAirline || "" : "");
      setAircraft(flight.aircraft || "");
      setLookupCallsign(flight.callsign || "");
      setLookupAircraftRegistration(flight.aircraftRegistration || "");
      setLookupAircraftModeS(flight.aircraftModeS || "");
      setLookupAirlineIata(flight.airlineIata || "");
      setLookupAirlineIcao(flight.airlineIcao || "");
      setLookupIsCodeshare(typeof flight.isCodeshare === "boolean" ? flight.isCodeshare : null);
      setTerminal(flight.departure.terminal || "");
      setGate(flight.departure.gate || "");

      // Auto-flag cancelled flights from the API. "diverted" gets folded
      // into "cancelled" because the flight-status enum doesn't have a
      // dedicated diverted bucket — user can edit later. Anything else
      // is left to the local date heuristic.
      if (flight.status === "cancelled" || flight.status === "diverted") {
        setStatus("cancelled");
      }

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

  // Derive which date-precision shape a historical departure date has.
  const historicalDateShape = (
    date: string
  ): "year" | "year_month" | "year_month_day" | "unknown" => {
    if (/^\d{4}$/.test(date)) return "year";
    if (/^\d{4}-\d{2}$/.test(date)) return "year_month";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return "year_month_day";
    return "unknown";
  };

  // Pick the IANA timezone for a side. Airports cached in the DB carry an
  // IANA timezone; fall back to the user's display timezone if the airport
  // record happens to be incomplete. Settings always has a string default
  // ("Europe/Berlin"), so the result is non-null in practice.
  const userTz = settings?.display?.timezone || "UTC";
  const depTz = departure?.timezone || userTz;
  const arrTz = arrival?.timezone || userTz;

  // Honour the user's "track aircraft registrations" opt-out: when off,
  // the lookup-derived tail number / Mode-S are dropped before submit so
  // the column stays NULL on the row. Default is ON.
  const trackAircraft = settings?.features?.trackAircraftRegistration !== false;

  const buildFlightPayload = (): FlightInput => {
    // For historical flights, derive time-semantics from the date-precision shape.
    // DATE_ONLY when the user knows the real calendar date but not the time;
    // UNKNOWN for year-only or year+month rows (no meaningful time at all).
    const depShape = status === "historical" ? historicalDateShape(departureDate) : "unknown";
    const depTimeSemantics: FlightInput["depTimeSemantics"] =
      depShape === "year_month_day" ? "DATE_ONLY" : depShape !== "unknown" ? "UNKNOWN" : undefined;
    const arrTimeSemantics: FlightInput["arrTimeSemantics"] = depTimeSemantics;

    // For DATE_ONLY historical rows, arrival mirrors departure so the wall-clock
    // duration is 0 (great-circle estimate takes over downstream). The form already
    // keeps arrivalDate in sync via setArrivalDate — this makes it explicit.
    const effectiveArrivalDate =
      status === "historical" && depShape === "year_month_day" ? departureDate : arrivalDate;
    const effectiveArrivalTime =
      status === "historical" && depShape === "year_month_day" ? departureTime : arrivalTime;

    return {
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
      airlineIata: lookupAirlineIata || undefined,
      airlineIcao: lookupAirlineIcao || undefined,
      operatingAirline: operatingAirline || undefined,
      isCodeshare: lookupIsCodeshare ?? undefined,
      flightNumber: flightNumber || undefined,
      callsign: lookupCallsign || undefined,
      aircraft: aircraft || undefined,
      aircraftRegistration: trackAircraft ? lookupAircraftRegistration || undefined : undefined,
      aircraftModeS: trackAircraft ? lookupAircraftModeS || undefined : undefined,
      seatClass: seatClass || undefined,
      seatNumber: seatNumber || undefined,
      terminal: terminal || undefined,
      gate: gate || undefined,
      // Server converts {departureLocal, depTimezone} -> real UTC via fromZonedTime.
      // No browser-side `new Date(...).toISOString()` — that would leak the
      // browser's local TZ into the payload.
      departureLocal: departureDate ? buildLocalString(departureDate, departureTime) : undefined,
      depTimezone: departureDate ? depTz : undefined,
      arrivalLocal: effectiveArrivalDate
        ? buildLocalString(effectiveArrivalDate, effectiveArrivalTime)
        : undefined,
      arrTimezone: effectiveArrivalDate ? arrTz : undefined,
      // Actual departure/arrival (#200) — same undefined-when-empty contract
      // as the scheduled pair above: leaving these blank must never emit an
      // empty string or null, only omit the field entirely (a flight with no
      // recorded actual time must stay that way). Paired with the SAME
      // airport timezone as its scheduled counterpart (depTz/arrTz) since
      // actual departure happens at the departure airport and actual arrival
      // at the arrival airport, same as the scheduled times.
      actualDepartureLocal: actualDepartureDate
        ? buildLocalString(actualDepartureDate, actualDepartureTime)
        : undefined,
      actualDepartureTz: actualDepartureDate ? depTz : undefined,
      actualArrivalLocal: actualArrivalDate
        ? buildLocalString(actualArrivalDate, actualArrivalTime)
        : undefined,
      actualArrivalTz: actualArrivalDate ? arrTz : undefined,
      depTimeSemantics,
      arrTimeSemantics,
      status,
      notes: notes || undefined,
      bookingReference: bookingReference || undefined,
      ticketNumber: ticketNumber || undefined,
      price,
      currency,
      taxes,
      fees,
      receiptUrl: receiptUrl || undefined,
      category,
      tags: tags.length ? tags : undefined,
      companions: companions.length ? companions : undefined,
      // `|| undefined` matters here: since #199 these are editable inputs,
      // and a blanked field must be OMITTED — an empty string would
      // overwrite a parser-provided value with nothing on the server.
      baggageAllowance: baggageAllowance || undefined,
      frequentFlyerNumber: frequentFlyerNumber || undefined,
      bookingClassLetter: bookingClassLetter || undefined,
      coPassengers: coPassengers.length ? coPassengers : undefined,
    };
  };

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
   * swaps departure/arrival airports, keeps booking-stable fields (airline,
   * category, tags, companions, booking reference, ticket number — the
   * return leg belongs to the same PNR/e-ticket) and clears leg-specific
   * ones (flight number, seat, gate, terminal, aircraft, times). The user
   * must pick new dates and times.
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
    // Price/taxes/fees stay (same PNR money, like the booking reference),
    // but the receipt is cleared: it is an uploaded FILE tied to the
    // outbound flight, and two flights referencing one stored file would
    // break the first flight's receipt when the other deletes it.
    setReceiptUrl("");
    setOperatingAirline("");
    setLookupCallsign("");
    setLookupAircraftRegistration("");
    setLookupAircraftModeS("");
    setLookupAirlineIata("");
    setLookupAirlineIcao("");
    setLookupIsCodeshare(null);

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

  /** Post-create trip assignment (#199) — a SECOND call on the Trip
   *  relation's own endpoint, strictly after a successful create, mirroring
   *  the edit modal's save-then-assign ordering. A failure here must not
   *  fail the submit: the flight exists either way, so the user gets a
   *  toast instead of a rolled-back-looking error. */
  const maybeAssignTrip = async (created: Flight | void): Promise<void> => {
    if (!tripId || !created?.id) return;
    try {
      await tripsApi.assignFlights(tripId, { flightIds: [created.id], action: "add" });
    } catch (err) {
      logger.warn("Failed to assign the new flight to the selected trip:", err);
      useToastStore.getState().addToast("error", t("flights:edit.tripAssignFailed"));
    }
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
      await maybeAssignTrip(await onSubmit(buildFlightPayload()));
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
      await maybeAssignTrip(await onSubmit(buildFlightPayload(), { hasMoreFlights: true }));
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
      await maybeAssignTrip(await onSubmit(buildFlightPayload(), { force: true }));
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

  /**
   * Resolve the duplicate dialog by merging new fields into the existing
   * flight. Backend fills only nullish fields on the existing row, so the
   * user's curated values are never overwritten — this is the safe path
   * when the second source (boarding pass / email) carries metadata the
   * first source didn't have (seat, gate, ticket number, …).
   */
  const handleMergeSubmit = async (): Promise<void> => {
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
      await maybeAssignTrip(await onSubmit(buildFlightPayload(), { merge: true }));
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
      await onSubmit(enrichedFlight, { hasMoreFlights });

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
    actualDepartureDate,
    actualDepartureTime,
    actualArrivalDate,
    actualArrivalTime,
    airline,
    operatingAirline,
    aircraft,
    terminal,
    gate,
    seatNumber,
    seatClass,
    status,
    notes,
    bookingReference,
    ticketNumber,
    bookingClassLetter,
    baggageAllowance,
    frequentFlyerNumber,
    price,
    currency,
    taxes,
    fees,
    receiptUrl,
    tripId,
    category,
    tags,
    companions,
    coPassengers,
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
    setActualDepartureDate,
    setActualDepartureTime,
    setActualArrivalDate,
    setActualArrivalTime,
    setAirline,
    setOperatingAirline,
    setAircraft,
    setTerminal,
    setGate,
    setSeatNumber,
    setSeatClass,
    setStatus,
    setNotes,
    setBookingReference,
    setTicketNumber,
    setBookingClassLetter,
    setBaggageAllowance,
    setFrequentFlyerNumber,
    setPrice,
    setCurrency,
    setTaxes,
    setFees,
    setReceiptUrl,
    setTripId,
    setCategory,
    setTags,
    setCompanions,
    // Handlers
    handleFlightLookup,
    handleSelectFlight,
    handleBoardingPassScan,
    handleSubmit,
    handleSubmitAndReturn,
    handleForceSubmit,
    handleMergeSubmit,
    handleFlightReviewConfirm,
  };
}

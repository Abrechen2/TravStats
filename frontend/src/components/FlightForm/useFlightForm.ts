import { useState, useEffect, useMemo, useRef } from "react";
import type { Airport } from "../../lib/api";
import { flightsApi } from "../../lib/api/flights";
import { tripsApi } from "../../lib/api/trips";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { flightLookupApi } from "../../lib/api/flightLookup";
import { todayIn } from "../../shared/time";
import { todayZoneNow } from "../../hooks/useTodayZone";
import { airportResolutionMessage, resolveAirportByCode } from "../../lib/airportResolve";
import {
  lookupEmptyMessage,
  lookupFormTimes,
  lookupRequestErrorMessage,
  lookupWallClock,
} from "./flightLookupActions";
import { useToastStore } from "../../store/toastStore";
import { storeHistoricalFlightTime, estimateFlightTimes } from "../../lib/timeEstimation";
import type { Flight, FlightInput, ParsedBooking, UserAchievement } from "../../types";
import type { TimeEstimationWarning } from "./FlightCompleteStep";

export type { FlightLookupResult, DuplicateFlight, FlightSubmitOptions } from "./flightFormModel";
export { buildLocalString } from "./flightFormModel";
import { isAlreadyImported } from "./flightFormModel";
import { airportZone, buildFlightPayload as buildFlightPayloadFrom } from "./flightPayload";
import { flightSaveFailure } from "./flightSaveFailure";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { reportBatchOutcome } from "./flightReviewBatch";
import type { FlightLookupResult, DuplicateFlight, FlightSubmitOptions } from "./flightFormModel";
import type { FlightFolds } from "../../lib/flightFolds";
import { shiftWallClock } from "../../lib/wallClockMath";

export function useFlightForm(
  // Returning the created Flight makes the post-create trip assignment
  // possible; `void` keeps older callers valid (they get no assignment).
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>,
  onCancel: () => void,
  onBatchComplete?: (newAchievements?: UserAchievement[]) => void
  /**
   * Opens straight into the e-mail/PDF uploader instead of the lookup step.
   * Used by the central import hub (#238): the hub carries the flight parse
   * route, but the multi-flight review loop lives here — so the hub sends the
   * user in rather than growing a second copy of it.
   */
) {
  const { t } = useTranslation(["flights", "errors"]);
  const settings = useSettingsStore();

  // UI State
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
  // The later occurrence of a repeated hour, per end (Q5) — see lib/flightFolds.ts.
  const [folds, setFolds] = useState<FlightFolds>({});
  // Actual departure/arrival (#200) — empty by default, not "midday": a new
  // flight has no recorded actual time until the user fills it in.
  const [actualDepartureDate, setActualDepartureDate] = useState("");
  const [actualDepartureTime, setActualDepartureTime] = useState("");
  const [actualArrivalDate, setActualArrivalDate] = useState("");
  const [actualArrivalTime, setActualArrivalTime] = useState("");
  const [airline, setAirline] = useState("");
  const [operatingAirline, setOperatingAirline] = useState("");
  const [aircraft, setAircraft] = useState("");
  // Lookup-derived metadata persisted on submit but not shown in the form
  // (callsign, tail number, Mode-S from AeroDataBox); editable on the detail view.
  const [lookupCallsign, setLookupCallsign] = useState("");
  const [lookupAircraftRegistration, setLookupAircraftRegistration] = useState("");
  const [lookupAircraftModeS, setLookupAircraftModeS] = useState("");
  const [lookupAirlineIata, setLookupAirlineIata] = useState("");
  const [lookupAirlineIcao, setLookupAirlineIcao] = useState("");
  const [lookupIsCodeshare, setLookupIsCodeshare] = useState<boolean | null>(null);
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
  const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
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

  // Initialize defaults from settings
  useEffect(() => {
    // Today in the profile zone (Q1) — neither UTC nor the browser's.
    const today = todayIn(todayZoneNow());
    setSearchDate(today);
    setDepartureDate(today);
    setArrivalDate(today);

    // The one currency the app has (see UnitsSection). Was
    // `units.currency`, which governed flights alone.
    if (settings?.baseCurrency) setCurrency(settings.baseCurrency);
    if (settings?.defaults?.flightCategory) setCategory(settings.defaults.flightCategory);
    if (settings?.defaults?.seatClass) setSeatClass(settings.defaults.seatClass);
  }, [settings]);

  // Auto-set status based on date (skip when historical is active)
  useEffect(() => {
    if (status === "historical") return;
    // Both `YYYY-MM-DD`: before today in the profile zone (Q1) is flown.
    if (departureDate) setStatus(departureDate < todayIn(todayZoneNow()) ? "flown" : "scheduled");
  }, [departureDate]);

  // Clear error when step changes — unless the transition itself carries a
  // notice (an airport the lookup could not resolve), which must survive it.
  const stepNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    setError(stepNoticeRef.current ?? "");
    stepNoticeRef.current = null;
  }, [step]);

  // Track if arrival date has been set manually (or by a picked lookup hit)
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
        // `estimateFlightTimes` takes a BOARDING time because it grew out of
        // the boarding-pass path. Here there is no boarding time — the user
        // typed a departure time — so one is synthesised by subtracting the
        // same 30 minutes the estimator will add back. The round trip cancels
        // out, which is why the resulting estimate is correct.
        //
        // This is an internal adaptation and must NOT leak into the copy: the
        // UI used to explain the result as "based on boarding time" and
        // "Departure = Boarding + 30min", telling the user their times came
        // from an input they never gave and sending them looking for a field
        // that does not exist on this form (#235).
        // Wall-clock arithmetic, not the browser's clock (lib/wallClockMath.ts).
        const boardingTime =
          shiftWallClock(departureDate, departureTime, -30)?.time ?? departureTime;

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
        // Two hours on the ticket's clock — the old code took the UTC date
        // and the browser's time, a different day east of UTC.
        const arr = shiftWallClock(departureDate, departureTime, 120);
        setArrivalDate(arr?.date ?? departureDate);
        setArrivalTime(arr?.time ?? departureTime);
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
      const data = await flightLookupApi.lookup<FlightLookupResult>(flightNumber, searchDate);
      if (!data.success || !data.flights || data.flights.length === 0) {
        // Stay on the input step so the error stays visible — the `step`
        // useEffect clears errors on every transition (issue #82 follow-up).
        // "Not configured", "provider failed" and "not found" each call for
        // a different action (#232), so each keeps its own sentence.
        setError(lookupEmptyMessage(data, t));
        return;
      }
      setLookupResults(data.flights);
      setStep("select");
    } catch (err) {
      logger.error("Flight lookup error:", err);
      setError(lookupRequestErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Select Flight from Lookup Results
  const handleSelectFlight = async (flight: FlightLookupResult) => {
    setSelectedFlight(flight);
    setLoading(true);
    try {
      const codes = [flight.departure.iata, flight.arrival.iata];
      const [depResolved, arrResolved] = await Promise.all(
        codes.map((code) => (code ? resolveAirportByCode(code) : Promise.resolve(null)))
      );
      const depAirport = depResolved?.kind === "found" ? depResolved.airport : null;
      const arrAirport = arrResolved?.kind === "found" ? arrResolved.airport : null;
      if (depAirport) setDeparture(depAirport);
      if (arrAirport) setArrival(arrAirport);
      // A code the catalogue cannot give back used to leave the field empty
      // without a word; now the form says which one and why.
      const unresolved = [depResolved, arrResolved].flatMap((r) =>
        r && r.kind !== "found" ? [airportResolutionMessage(r)] : []
      );

      setAirline(flight.airline);
      // Codeshare path: surface the operating carrier so stats can group on
      // the real metal; non-codeshare entries leave operatingAirline empty.
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

      // "diverted" folds into "cancelled" — the status enum has no bucket for it.
      if (flight.status === "cancelled" || flight.status === "diverted") {
        setStatus("cancelled");
      }

      // Each side on its OWN airport's clock — see lookupWallClock.
      const times = lookupFormTimes(
        lookupWallClock(flight.departure, depAirport?.timezone),
        lookupWallClock(flight.arrival, arrAirport?.timezone),
        searchDate
      );
      if (times.departureDate) setDepartureDate(times.departureDate);
      if (times.departureTime) setDepartureTime(times.departureTime);
      if (times.arrivalDate) setArrivalDate(times.arrivalDate);
      if (times.arrivalTime) setArrivalTime(times.arrivalTime);
      // The provider's arrival is data, not a guess: keep the duration
      // estimator below from overwriting it once the airports land.
      if (times.arrivalDate && times.arrivalTime) arrivalDateSetRef.current = true;

      if (unresolved.length > 0) {
        stepNoticeRef.current = unresolved.map((u) => t(u.key, u.params)).join(" ");
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

  // Live validation. A historical row is allowed to carry a day without a
  // clock reading; an ordinary one is not. Blank scheduled times used to slip
  // through here and get backfilled with noon on the way out, so the flight
  // recorded a departure the user never typed. A half-filled actual pair
  // (date, no time) is blocked for the same reason — it fabricated an actual
  // departure and, with it, a delay.
  const actualPairIncomplete =
    (!!actualDepartureDate && !actualDepartureTime) || (!!actualArrivalDate && !actualArrivalTime);

  const canSubmit = useMemo(
    () =>
      status === "historical"
        ? !!(departure && arrival)
        : !!(
            departure &&
            arrival &&
            departureDate &&
            departureTime &&
            arrivalDate &&
            arrivalTime &&
            !actualPairIncomplete
          ),
    [
      departure,
      arrival,
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      actualPairIncomplete,
      status,
    ]
  );

  // A side's zone is its airport's, never a fallback (ADR 0002 D2; see airportZone).
  const depTz = airportZone(departure);
  const arrTz = airportZone(arrival);

  // Honour the user's "track aircraft registrations" opt-out: when off,
  // the lookup-derived tail number / Mode-S are dropped before submit so
  // the column stays NULL on the row. Default is ON.
  const trackAircraft = settings?.features?.trackAircraftRegistration !== false;

  const buildFlightPayload = (): FlightInput =>
    buildFlightPayloadFrom({
      status,
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      departure,
      arrival,
      airline,
      lookupAirlineIata,
      lookupAirlineIcao,
      operatingAirline,
      lookupIsCodeshare,
      flightNumber,
      lookupCallsign,
      aircraft,
      trackAircraft,
      lookupAircraftRegistration,
      lookupAircraftModeS,
      seatClass,
      seatNumber,
      terminal,
      gate,
      boardingGroup,
      depTz,
      arrTz,
      actualDepartureDate,
      actualDepartureTime,
      actualArrivalDate,
      actualArrivalTime,
      notes,
      bookingReference,
      ticketNumber,
      price,
      currency,
      taxes,
      fees,
      receiptUrl,
      category,
      tags,
      companions,
      baggageAllowance,
      frequentFlyerNumber,
      bookingClassLetter,
      coPassengers,
      folds,
    });

  const storeHistoricalData = () => {
    if (flightNumber && departureTime && arrivalTime && departure?.iata && arrival?.iata) {
      const estimatedBoardingTime =
        shiftWallClock(departureDate, departureTime, -30)?.time ?? departureTime;
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
    // canSubmit only greys out the button; Enter in any input still submits
    // the form. The time rules have to hold here too, or the guard is
    // decorative — that is how a blank required time reached the wire as noon.
    if (!canSubmit) {
      setError(t("errors:missingTimes"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      storeHistoricalData();
      setTimeEstimationWarning(null);
      await maybeAssignTrip(await onSubmit(buildFlightPayload()));
    } catch (err: unknown) {
      const failure = flightSaveFailure(err, t);
      if (failure.kind === "duplicate") {
        setDuplicateFlight(failure.existing);
        setLoading(false);
        return;
      }
      setError(failure.message);
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
    // canSubmit only greys out the button; Enter in any input still submits
    // the form. The time rules have to hold here too, or the guard is
    // decorative — that is how a blank required time reached the wire as noon.
    if (!canSubmit) {
      setError(t("errors:missingTimes"));
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
      const failure = flightSaveFailure(err, t);
      if (failure.kind === "duplicate") {
        setDuplicateFlight(failure.existing);
        return;
      }
      setError(failure.message);
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
      setError(saveErrorMessage(err, t, "errors:saveFailed"));
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
      setError(saveErrorMessage(err, t, "errors:saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleFlightReviewConfirm = async (flightData: FlightInput) => {
    const sourceFlight = parsedFlights[currentFlightIndex];
    setBaggageAllowance(sourceFlight?.baggageAllowance);
    setFrequentFlyerNumber(sourceFlight?.frequentFlyerNumber);
    setBookingClassLetter(sourceFlight?.bookingClassLetter);
    setBoardingGroup(sourceFlight?.boardingGroup ?? "");
    setCoPassengers(sourceFlight?.coPassengers ?? []);

    const enrichedFlight: FlightInput = {
      ...flightData,
      importBatchId,
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
          const submittedCount = confirmedFlightsRef.current.length;
          const batchResult = await flightsApi.createBatch(
            confirmedFlightsRef.current,
            importBatchId
          );

          reportBatchOutcome(batchResult, submittedCount, t);

          confirmedFlightsRef.current = [];
          setShowFlightReview(false);
          setParsedFlights([]);
          setCurrentFlightIndex(0);
          setImportBatchId(null);
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
      // Single flight — use the existing onSubmit callback. A repeat of the
      // same confirmation is counted, not treated as a failed save: the user
      // did nothing wrong, and "saving failed" would send them looking for a
      // problem that isn't there.
      try {
        await onSubmit(enrichedFlight, { hasMoreFlights });
      } catch (err: unknown) {
        if (!isAlreadyImported(err)) throw err;
        useToastStore.getState().addToast("info", t("flights:form.alreadyImported"));
      }

      if (hasMoreFlights) {
        setCurrentFlightIndex(nextIndex);
      } else {
        setShowFlightReview(false);
        setParsedFlights([]);
        setCurrentFlightIndex(0);
        setImportBatchId(null);
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
    boardingGroup,
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
    folds,
    // Setters
    setLoading,
    setError,
    setDuplicateFlight,
    setShowScanner,
    setStep,
    setTimeEstimationWarning,
    setParsedFlights,
    setImportBatchId,
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
    setFolds,
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
    setBoardingGroup,
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

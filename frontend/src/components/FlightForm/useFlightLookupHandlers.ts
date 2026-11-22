import { flightLookupApi } from "../../lib/api/flightLookup";
import { logger } from "../../lib/logger";
import { airportResolutionMessage, resolveAirportByCode } from "../../lib/airportResolve";
import {
  lookupEmptyMessage,
  lookupFormTimes,
  lookupRequestErrorMessage,
  lookupWallClock,
} from "./flightLookupActions";
import type { ParsedBooking } from "../../types";
import type { FlightLookupResult } from "./flightFormModel";
import type { FlightFormRefs } from "./useFlightFormEffects";
import type { FlightFormState } from "./useFlightFormState";
import type { useTranslation } from "../../hooks/useTranslation";

type T = ReturnType<typeof useTranslation>["t"];

/** The lookup by number and date, picking a hit, and the boarding-pass scan. */
export function useFlightLookupHandlers(s: FlightFormState, refs: FlightFormRefs, t: T) {
  // Flight Lookup Handler
  const handleFlightLookup = async () => {
    if (!s.flightNumber.trim()) {
      s.setError(t("errors:noFlightNumber"));
      return;
    }
    s.setLoading(true);
    s.setError("");
    try {
      const data = await flightLookupApi.lookup<FlightLookupResult>(s.flightNumber, s.searchDate);
      if (!data.success || !data.flights || data.flights.length === 0) {
        // Stay on the input step so the error stays visible — the `step`
        // useEffect clears errors on every transition (issue #82 follow-up).
        // "Not configured", "provider failed" and "not found" each call for
        // a different action (#232), so each keeps its own sentence.
        s.setError(lookupEmptyMessage(data, t));
        return;
      }
      s.setLookupResults(data.flights);
      s.setStep("select");
    } catch (err) {
      logger.error("Flight lookup error:", err);
      s.setError(lookupRequestErrorMessage(err, t));
    } finally {
      s.setLoading(false);
    }
  };

  // Select Flight from Lookup Results
  const handleSelectFlight = async (flight: FlightLookupResult) => {
    s.setSelectedFlight(flight);
    s.setLoading(true);
    try {
      const codes = [flight.departure.iata, flight.arrival.iata];
      const [depResolved, arrResolved] = await Promise.all(
        codes.map((code) => (code ? resolveAirportByCode(code) : Promise.resolve(null)))
      );
      const depAirport = depResolved?.kind === "found" ? depResolved.airport : null;
      const arrAirport = arrResolved?.kind === "found" ? arrResolved.airport : null;
      if (depAirport) s.setDeparture(depAirport);
      if (arrAirport) s.setArrival(arrAirport);
      // A code the catalogue cannot give back used to leave the field empty
      // without a word; now the form says which one and why.
      const unresolved = [depResolved, arrResolved].flatMap((r) =>
        r && r.kind !== "found" ? [airportResolutionMessage(r)] : []
      );

      applyLookupHit(s, flight);

      // Each side on its OWN airport's clock — see lookupWallClock.
      const times = lookupFormTimes(
        lookupWallClock(flight.departure, depAirport?.timezone),
        lookupWallClock(flight.arrival, arrAirport?.timezone),
        s.searchDate
      );
      if (times.departureDate) s.setDepartureDate(times.departureDate);
      if (times.departureTime) s.setDepartureTime(times.departureTime);
      if (times.arrivalDate) s.setArrivalDate(times.arrivalDate);
      if (times.arrivalTime) s.setArrivalTime(times.arrivalTime);
      // The provider's arrival is data, not a guess: keep the duration
      // estimator below from overwriting it once the airports land.
      if (times.arrivalDate && times.arrivalTime) refs.arrivalDateSetRef.current = true;

      if (unresolved.length > 0) {
        refs.stepNoticeRef.current = unresolved.map((u) => t(u.key, u.params)).join(" ");
      }
      s.setStep("complete");
    } catch {
      s.setError(t("errors:failedToLoadAirport"));
    } finally {
      s.setLoading(false);
    }
  };

  // Boarding Pass Scanner
  // The same review the mail import uses, one flight after the other.
  const handleBoardingPassScan = async (flights: ParsedBooking[]) => {
    s.setShowScanner(false);
    s.setError("");
    s.setParsedFlights(flights);
    s.setCurrentFlightIndex(0);
    s.setShowFlightReview(true);
  };

  return { handleFlightLookup, handleSelectFlight, handleBoardingPassScan };
}

/** What a picked hit fills in: airline, aircraft, the hidden lookup metadata, gate and status. */
function applyLookupHit(s: FlightFormState, flight: FlightLookupResult): void {
  const { meta } = s;
  s.setAirline(flight.airline);
  // Codeshare path: surface the operating carrier so stats can group on
  // the real metal; non-codeshare entries leave operatingAirline empty.
  s.setOperatingAirline(flight.isCodeshare ? flight.operatingAirline || "" : "");
  s.setAircraft(flight.aircraft || "");
  meta.setLookupCallsign(flight.callsign || "");
  meta.setLookupAircraftRegistration(flight.aircraftRegistration || "");
  meta.setLookupAircraftModeS(flight.aircraftModeS || "");
  meta.setLookupAirlineIata(flight.airlineIata || "");
  meta.setLookupAirlineIcao(flight.airlineIcao || "");
  meta.setLookupIsCodeshare(typeof flight.isCodeshare === "boolean" ? flight.isCodeshare : null);
  s.setTerminal(flight.departure.terminal || "");
  s.setGate(flight.departure.gate || "");

  // "diverted" folds into "cancelled" — the status enum has no bucket for it.
  if (flight.status === "cancelled" || flight.status === "diverted") {
    s.setStatus("cancelled");
  }
}

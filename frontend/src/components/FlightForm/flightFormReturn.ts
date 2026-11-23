import type { MutableRefObject } from "react";
import type { FlightFormState } from "./useFlightFormState";

/**
 * After a successful save, prepare the form for entering the return leg:
 * swaps departure/arrival airports, keeps booking-stable fields (airline,
 * category, tags, companions, booking reference, ticket number — the
 * return leg belongs to the same PNR/e-ticket) and clears leg-specific
 * ones (flight number, seat, gate, terminal, aircraft, times). The user
 * must pick new dates and times.
 */
export function prepareReturnLegForm(
  s: FlightFormState,
  arrivalDateSetRef: MutableRefObject<boolean>
): void {
  const outboundDeparture = s.departure;
  const outboundArrival = s.arrival;
  s.setDeparture(outboundArrival);
  s.setArrival(outboundDeparture);

  s.setFlightNumber("");
  s.setAircraft("");
  s.setTerminal("");
  s.setGate("");
  s.setSeatNumber("");
  s.setNotes("");
  // Price/taxes/fees stay (same PNR money, like the booking reference),
  // but the receipt is cleared: it is an uploaded FILE tied to the
  // outbound flight, and two flights referencing one stored file would
  // break the first flight's receipt when the other deletes it.
  s.setReceiptUrl("");
  s.setOperatingAirline("");
  s.meta.setLookupCallsign("");
  s.meta.setLookupAircraftRegistration("");
  s.meta.setLookupAircraftModeS("");
  s.meta.setLookupAirlineIata("");
  s.meta.setLookupAirlineIcao("");
  s.meta.setLookupIsCodeshare(null);

  // Default the new departure date to the original arrival date, time empty —
  // user usually picks both. For a same-day return this is what they want;
  // for a multi-day trip they bump the date forward.
  if (s.arrivalDate) {
    s.setDepartureDate(s.arrivalDate);
    s.setArrivalDate(s.arrivalDate);
  }
  s.setDepartureTime("12:00");
  s.setArrivalTime("14:00");
  arrivalDateSetRef.current = false;

  s.setStep("complete");
  s.setError("");
  s.setTimeEstimationWarning(null);
}

/**
 * After a successful save, prepare the form for the NEXT flight of a
 * multi-leg day ("Weiteren Flug anlegen"). Unlike the return leg this is not
 * the same booking: it keeps what a traveller repeats from flight to flight —
 * airline, trip, cabin class, companions — starts at the airport the last
 * flight ended at, leaves the destination open, and suggests the previous
 * arrival date. Everything booking-specific (reference, ticket, price,
 * receipt) and leg-specific (number, seat, gate, aircraft, times) starts empty.
 */
export function prepareNextLegForm(
  s: FlightFormState,
  arrivalDateSetRef: MutableRefObject<boolean>
): void {
  s.setDeparture(s.arrival);
  s.setArrival(null);

  s.setFlightNumber("");
  s.setAircraft("");
  s.setTerminal("");
  s.setGate("");
  s.setSeatNumber("");
  s.setBoardingGroup("");
  s.setNotes("");
  s.setReceiptUrl("");
  s.setOperatingAirline("");
  s.setBookingReference("");
  s.setTicketNumber("");
  s.setBookingClassLetter("");
  s.setPrice(undefined);
  s.setTaxes(undefined);
  s.setFees(undefined);
  s.meta.setLookupCallsign("");
  s.meta.setLookupAircraftRegistration("");
  s.meta.setLookupAircraftModeS("");
  s.meta.setLookupAirlineIata("");
  s.meta.setLookupAirlineIcao("");
  s.meta.setLookupIsCodeshare(null);

  if (s.arrivalDate) {
    s.setDepartureDate(s.arrivalDate);
    s.setArrivalDate(s.arrivalDate);
  }
  s.setDepartureTime("12:00");
  s.setArrivalTime("14:00");
  arrivalDateSetRef.current = false;

  s.setStep("complete");
  s.setError("");
  s.setTimeEstimationWarning(null);
}

import type { Airport } from "../../lib/api";
import { MissingZoneError } from "../../lib/api/timeInput";
import { isValidZone } from "../../shared/time";
import type { FlightInput } from "../../types";
import { historicalDateShape } from "./fields/HistoricalDateFields";
import { buildLocalString } from "./flightFormModel";
import { foldFields, type FlightFoldFields, type FlightFolds } from "../../lib/flightFolds";

/**
 * The create-form state turned into the POST body — a pure function of the
 * fields, split out of useFlightForm.ts (file-size debt, forgejo#59). The body
 * is unchanged; the hook passes its current state in by name.
 */
export interface FlightPayloadFields {
  status: "scheduled" | "flown" | "cancelled" | "historical";
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  departure: Airport | null;
  arrival: Airport | null;
  airline: string;
  lookupAirlineIata: string;
  lookupAirlineIcao: string;
  operatingAirline: string;
  lookupIsCodeshare: boolean | null;
  flightNumber: string;
  lookupCallsign: string;
  aircraft: string;
  trackAircraft: boolean;
  lookupAircraftRegistration: string;
  lookupAircraftModeS: string;
  seatClass: "" | "economy" | "premium_economy" | "business" | "first";
  seatNumber: string;
  terminal: string;
  gate: string;
  boardingGroup: string;
  /** The departure airport's zone; null when its record carries none. */
  depTz: string | null;
  /** The arrival airport's zone; null when its record carries none. */
  arrTz: string | null;
  actualDepartureDate: string;
  actualDepartureTime: string;
  actualArrivalDate: string;
  actualArrivalTime: string;
  notes: string;
  bookingReference: string;
  ticketNumber: string;
  price: number | undefined;
  currency: string;
  taxes: number | undefined;
  fees: number | undefined;
  receiptUrl: string;
  category: "" | "business" | "private" | "vacation";
  tags: string[];
  companions: string[];
  baggageAllowance: string | undefined;
  frequentFlyerNumber: string | undefined;
  bookingClassLetter: string | undefined;
  coPassengers: string[];
  /** The later occurrence of a repeated hour, per end (Q5). */
  folds?: FlightFolds;
}

/**
 * The zone a flight time at `airport` is read in: the airport's own, and
 * nothing else (ADR 0002, D2). The form used to fall back to the user's
 * profile zone and then to "UTC", which stored a Tokyo departure on the
 * reader's clock whenever an airport record lacked its zone. Null now, and
 * `buildFlightPayload` refuses rather than guess.
 */
export function airportZone(airport: Pick<Airport, "timezone"> | null): string | null {
  const zone = airport?.timezone ?? null;
  return zone && isValidZone(zone) ? zone : null;
}

/** A time at an airport whose record has no zone cannot be sent (`TZ_UNRESOLVED`). */
function zoneFor(field: string, zone: string | null): string {
  if (!zone) throw new MissingZoneError(field);
  return zone;
}

export function buildFlightPayload(fields: FlightPayloadFields): FlightInput & FlightFoldFields {
  const {
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
    folds = {},
  } = fields;
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

  // Only a historical row may anchor a bare day to noon; see buildLocalString.
  const anchorDateOnly = status === "historical";

  const departureLocal = departureDate
    ? (buildLocalString(departureDate, departureTime, { anchorDateOnly }) ?? undefined)
    : undefined;
  const arrivalLocal = effectiveArrivalDate
    ? (buildLocalString(effectiveArrivalDate, effectiveArrivalTime, { anchorDateOnly }) ??
      undefined)
    : undefined;

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
    // "" = the explicit "(optional)" choice. null on the wire, NULL in the
    // DB — undefined would let the server's column default decide instead
    // of the user.
    seatClass: seatClass || null,
    seatNumber: seatNumber || undefined,
    terminal: terminal || undefined,
    gate: gate || undefined,
    // Omitted when empty — "" would overwrite a parser-provided value.
    boardingGroup: boardingGroup || undefined,
    // Server converts {departureLocal, depTimezone} -> real UTC via fromZonedTime.
    // No browser-side `new Date(...).toISOString()` — that would leak the
    // browser's local TZ into the payload.
    departureLocal,
    depTimezone: departureDate ? zoneFor("departureLocal", depTz) : undefined,
    arrivalLocal,
    arrTimezone: effectiveArrivalDate ? zoneFor("arrivalLocal", arrTz) : undefined,
    // "Die spätere meinen" (Q5), only while the sent time is repeated there.
    ...foldFields(
      folds,
      { local: departureLocal, zone: depTz },
      { local: arrivalLocal, zone: arrTz }
    ),
    // Actual departure/arrival (#200) — same undefined-when-empty contract
    // as the scheduled pair above: leaving these blank must never emit an
    // empty string or null, only omit the field entirely (a flight with no
    // recorded actual time must stay that way). Paired with the SAME
    // airport timezone as its scheduled counterpart (depTz/arrTz) since
    // actual departure happens at the departure airport and actual arrival
    // at the arrival airport, same as the scheduled times.
    // Never anchored: an actual time is a recorded observation. A date
    // without a clock reading is incomplete input (canSubmit blocks it),
    // not a midpoint to guess at.
    actualDepartureLocal: actualDepartureDate
      ? (buildLocalString(actualDepartureDate, actualDepartureTime) ?? undefined)
      : undefined,
    actualDepartureTz: actualDepartureDate ? zoneFor("actualDepartureLocal", depTz) : undefined,
    actualArrivalLocal: actualArrivalDate
      ? (buildLocalString(actualArrivalDate, actualArrivalTime) ?? undefined)
      : undefined,
    actualArrivalTz: actualArrivalDate ? zoneFor("actualArrivalLocal", arrTz) : undefined,
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
    category: category || null,
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
}

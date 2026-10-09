import type { Flight, FlightInput } from "../../types";
import type { Airport } from "../../lib/api";
import { splitTagText } from "../../lib/tagList";
import { foldFields, wallOf, type FlightFolds } from "../../lib/flightFolds";
import { historicalDateShape } from "./fields/HistoricalDateFields";
import {
  historicalShapeFor,
  seedTimes,
  TIME_INPUT_KEYS,
  type EditTimeInputs,
} from "./editModalDatetime";
import { buildLocalString } from "./flightFormModel";
import type { MissingStep } from "../form";
import type { TimesFieldErrors } from "./fields/TimesFields";
import { negativeCostGaps } from "./createFormState";
import { tripsApi } from "../../lib/api/trips";

/**
 * The flight EDIT form's model, out of `FlightEditModal.tsx` (which sat at
 * 794 of its 800 lines): the draft built from a flight, the update it sends,
 * what is missing before it can save, and what counts as a change worth
 * asking about (forgejo#245–#248). Moved, not rewritten — the comments
 * travelled with the code.
 */

/** Build the `Airport` shape RouteFields expects from a flight's stored
 *  departure/arrival columns, falling back to the code when no name was
 *  ever captured. */
export function buildFlightAirports(f: Flight): { departure: Airport; arrival: Airport } {
  const side = (iata?: string, icao?: string, name?: string, lat = 0, lon = 0): Airport => ({
    iata,
    icao,
    name: name || iata || icao || "",
    lat,
    lon,
  });
  return {
    departure: side(f.depIata, f.depIcao, f.depName, f.depLat, f.depLon),
    arrival: side(f.arrIata, f.arrIcao, f.arrName, f.arrLat, f.arrLon),
  };
}

export type EditFormData = ReturnType<typeof buildEditFormData>;

/** The edit form's input ids — labels name them, the missing-steps line and a refusal focus them. */
export const EDIT_IDS = {
  departureAirport: "flight-edit-departure-airport",
  arrivalAirport: "flight-edit-arrival-airport",
  airline: "flight-edit-airline",
  operatingAirline: "flight-edit-operating-airline",
  flightNumber: "flight-edit-flight-number",
  aircraft: "flight-edit-aircraft",
  category: "flight-edit-category",
  seatClass: "flight-edit-seat-class",
  seat: "flight-edit-seat",
  gate: "flight-edit-gate",
  terminal: "flight-edit-terminal",
  boardingGroup: "flight-edit-boarding-group",
  notes: "flight-edit-notes",
  cost: "flight-edit-cost",
  depDate: "editDepartureDate",
  depTime: "editDepartureTime",
  arrDate: "editArrivalDate",
  arrTime: "editArrivalTime",
  actualDepDate: "editActualDepartureDate",
  actualDepTime: "editActualDepartureTime",
  actualArrDate: "editActualArrivalDate",
  actualArrTime: "editActualArrivalTime",
} as const;

export function buildEditFormData(f: Flight) {
  const isHistorical = f.status === "historical";
  // The airports' own clocks from `times`; actual times (#200) empty when none.
  const { dep, arr, actualDep, actualArr } = seedTimes(f);
  return {
    airline: f.airline || "",
    operatingAirline: f.operatingAirline || "",
    flightNumber: f.flightNumber || "",
    aircraft: f.aircraft || "",
    status: f.status || "scheduled",
    category: f.category || "",
    seatClass: f.seatClass || "",
    seatNumber: f.seatNumber || "",
    gate: f.gate || "",
    terminal: f.terminal || "",
    boardingGroup: f.boardingGroup || "",
    bookingReference: f.bookingReference || "",
    ticketNumber: f.ticketNumber || "",
    bookingClassLetter: f.bookingClassLetter || "",
    baggageAllowance: f.baggageAllowance || "",
    frequentFlyerNumber: f.frequentFlyerNumber || "",
    companions: f.companions ?? [],
    // `?? undefined`, never `|| 0`: the modal used to load a stored 0 and a
    // stored null into the same form state, and write `> 0 ? … : null`
    // back — so changing only the seat number DELETED a valid zero price,
    // and `priceBase`, `fxRate` and the currency metadata went with it
    // (audit 2026-09-20, SRV-UI-001). `undefined` is the one value
    // `CostFields` reads as "not recorded".
    price: f.price ?? undefined,
    currency: f.currency || "EUR",
    taxes: f.taxes ?? undefined,
    fees: f.fees ?? undefined,
    notes: f.notes || "",
    tags: f.tags?.join(", ") || "",
    receiptUrl: f.receiptUrl || "",
    // Historical: shape string, empty time (buildLocalString anchors the
    // expanded date itself — 00:00 for partial shapes, 12:00 for full).
    departureDate: isHistorical ? historicalShapeFor(dep.date, f.depTimeSemantics) : dep.date,
    departureTime: isHistorical ? "" : dep.time,
    arrivalDate: isHistorical ? historicalShapeFor(dep.date, f.depTimeSemantics) : arr.date,
    arrivalTime: isHistorical ? "" : arr.time,
    actualDepartureDate: actualDep.date,
    actualDepartureTime: actualDep.time,
    actualArrivalDate: actualArr.date,
    actualArrivalTime: actualArr.time,
    tripId: f.tripId ?? "",
  };
}

export function buildEditUpdates({
  formData,
  flight,
  zones,
  folds,
  departureAirport,
  arrivalAirport,
}: {
  formData: EditFormData;
  flight: Flight;
  zones: { dep: string; arr: string } | null;
  folds: FlightFolds;
  departureAirport: Airport | null;
  arrivalAirport: Airport | null;
}): Partial<FlightInput> {
  // Historical flights carry their precision in the date SHAPE — the
  // create form's derivation. ALWAYS sent with departureLocal: without
  // explicit semantics the server reads a real time edit and flips the
  // column to UTC (flights.test.ts pins it) — which the browser UAT caught
  // silently downgrading DATE_ONLY on a year change.
  const histShape =
    formData.status === "historical" ? historicalDateShape(formData.departureDate) : "unknown";
  const sendSemantics: FlightInput["depTimeSemantics"] =
    histShape === "year_month_day" ? "DATE_ONLY" : histShape !== "unknown" ? "UNKNOWN" : undefined;

  return {
    // Server needs lat/lon to recompute status/CO2/distance.
    departure: departureAirport ?? undefined,
    arrival: arrivalAirport ?? undefined,
    // For every text/number field below: "" (a blanked input) maps to
    // null — an explicit CLEAR on the wire. undefined would omit the
    // field and the server would keep the old value while the UI showed
    // it removed. Same contract the category/seatClass fix established.
    airline: formData.airline || null,
    operatingAirline: formData.operatingAirline || null,
    flightNumber: formData.flightNumber || null,
    aircraft: formData.aircraft || null,
    status: formData.status as FlightInput["status"],
    // "" (the "(optional)" choice) is null too — the same explicit CLEAR.
    category: (formData.category || null) as FlightInput["category"],
    seatClass: (formData.seatClass || null) as FlightInput["seatClass"],
    seatNumber: formData.seatNumber || null,
    gate: formData.gate || null,
    terminal: formData.terminal || null,
    boardingGroup: formData.boardingGroup || null,
    bookingReference: formData.bookingReference || null,
    ticketNumber: formData.ticketNumber || null,
    bookingClassLetter: formData.bookingClassLetter || null,
    baggageAllowance: formData.baggageAllowance || null,
    frequentFlyerNumber: formData.frequentFlyerNumber || null,
    companions: formData.companions,
    // A recorded 0 is a price — an award flight, a staff ticket — and
    // only an empty field is `null`. See `shared/flightPricing.ts`.
    price: formData.price ?? null,
    currency: formData.currency as FlightInput["currency"],
    taxes: formData.taxes ?? null,
    fees: formData.fees ?? null,
    notes: formData.notes || null,
    tags: splitTagText(formData.tags),
    receiptUrl: formData.receiptUrl || null,
    ...(zones && {
      // Recombine with the SAME buildLocalString the create form uses —
      // no second implementation of date+time recombination.
      // Only a historical row may anchor a bare day to noon — see
      // buildLocalString. On the ordinary path a blank time is incomplete
      // input, and the submit guard above refuses it rather than letting a
      // fabricated midday depart.
      departureLocal: formData.departureDate
        ? (buildLocalString(formData.departureDate, formData.departureTime, {
            anchorDateOnly: formData.status === "historical",
          }) ?? undefined)
        : undefined,
      depTimezone: formData.departureDate ? zones.dep : undefined,
      arrivalLocal: formData.arrivalDate
        ? (buildLocalString(formData.arrivalDate, formData.arrivalTime, {
            anchorDateOnly: formData.status === "historical",
          }) ?? undefined)
        : undefined,
      arrTimezone: formData.arrivalDate ? zones.arr : undefined,
      depTimeSemantics: sendSemantics,
      arrTimeSemantics: sendSemantics,
      // Actual departure/arrival (#200) — three-way contract: a filled
      // field submits its value; an empty field on a flight that HAS a
      // stored actual time submits null (the user cleared it — delay
      // resets with it server-side); an empty field on a flight that
      // never had one omits the key entirely, so the no-op save stays a
      // no-op. Blank-means-omit alone made clearing a recorded actual
      // time impossible — the same silent-keep family as the text fields.
      actualDepartureLocal: formData.actualDepartureDate
        ? buildLocalString(formData.actualDepartureDate, formData.actualDepartureTime)
        : flight.actualDeparture
          ? null
          : undefined,
      actualDepartureTz: formData.actualDepartureDate ? zones.dep : undefined,
      actualArrivalLocal: formData.actualArrivalDate
        ? buildLocalString(formData.actualArrivalDate, formData.actualArrivalTime)
        : flight.actualArrival
          ? null
          : undefined,
      actualArrivalTz: formData.actualArrivalDate ? zones.arr : undefined,
      ...foldFields(
        folds,
        wallOf(formData.departureDate, formData.departureTime, zones.dep),
        wallOf(formData.arrivalDate, formData.arrivalTime, zones.arr)
      ),
    }),
  };
}

/**
 * What is missing before the edit can be saved — the submit guard's own two
 * rules, item by item: the four scheduled fields of a non-historical flight,
 * and the clock of an actual date. The airports are never "missing" here:
 * an empty picker keeps the stored airport (RouteFields).
 */
export function editFormGaps(formData: EditFormData, t: (k: string) => string): MissingStep[] {
  const gaps: MissingStep[] = [];
  const add = (field: string, key: string): void => {
    gaps.push({ field, label: t(`flights:form.missing.${key}`) });
  };
  if (formData.status !== "historical") {
    if (!formData.departureDate) add(EDIT_IDS.depDate, "departureDate");
    if (!formData.departureTime) add(EDIT_IDS.depTime, "departureTime");
    if (!formData.arrivalDate) add(EDIT_IDS.arrDate, "arrivalDate");
    if (!formData.arrivalTime) add(EDIT_IDS.arrTime, "arrivalTime");
  }
  if (formData.actualDepartureDate && !formData.actualDepartureTime) {
    add(EDIT_IDS.actualDepTime, "actualDepartureTime");
  }
  if (formData.actualArrivalDate && !formData.actualArrivalTime) {
    add(EDIT_IDS.actualArrTime, "actualArrivalTime");
  }
  gaps.push(...negativeCostGaps(formData, EDIT_IDS.cost, t));
  return gaps;
}

/** A half-filled actual pair, at its missing clock. */
export function editActualPairErrors(
  formData: EditFormData,
  t: (k: string) => string
): TimesFieldErrors {
  const missing = t("flights:form.errors.actualTimeMissing");
  return {
    actualDepTime: formData.actualDepartureDate && !formData.actualDepartureTime ? missing : null,
    actualArrTime: formData.actualArrivalDate && !formData.actualArrivalTime ? missing : null,
  };
}

/**
 * What "changed" means for the discard question (forgejo#248). The eight
 * time inputs count as untouched while they equal ANY rendering of the stored
 * instants — the seed, or the airport-local reading the hydration effect
 * writes once the zones resolve — the same rule `editSubmitZones` uses to send
 * no time at all. Without it, merely opening a flight read as a change.
 */
export function editFormSnapshot(
  formData: EditFormData,
  storedTimes: readonly EditTimeInputs[],
  airports: { departure: Airport | null; arrival: Airport | null },
  folds: FlightFolds
): unknown {
  const times = TIME_INPUT_KEYS.map((key) => formData[key]);
  const untouched = storedTimes.some((stored) =>
    TIME_INPUT_KEYS.every((key) => formData[key] === stored[key])
  );
  const code = (a: Airport | null) => (a ? (a.icao ?? a.iata ?? a.name ?? "") : "");
  const rest = Object.fromEntries(
    Object.entries(formData).filter(
      ([key]) => !(TIME_INPUT_KEYS as readonly string[]).includes(key)
    )
  );
  return {
    ...rest,
    times: untouched ? "stored" : times,
    departureAirport: code(airports.departure),
    arrivalAirport: code(airports.arrival),
    folds,
  };
}

/**
 * Moves the flight to the trip the form names, or off its trip — after the
 * save went through, never before. True when something changed. Throws when
 * the trip endpoint refuses; the flight itself is stored either way.
 */
export async function applyTripChange(flight: Flight, nextTripId: string): Promise<boolean> {
  const previousTripId = flight.tripId ?? "";
  if (nextTripId === previousTripId) return false;
  if (nextTripId) {
    // Add to the new trip — the backend uses updateMany, so this also moves
    // the flight away from any prior trip atomically.
    await tripsApi.assignFlights(nextTripId, { flightIds: [flight.id], action: "add" });
  } else {
    await tripsApi.assignFlights(previousTripId, { flightIds: [flight.id], action: "remove" });
  }
  return true;
}

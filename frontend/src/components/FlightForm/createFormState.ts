import type { MissingStep } from "../form";
import type { Airport } from "../../lib/api";
import { TIMES_FIELD_DEFAULT_IDS, type TimesFieldErrors } from "./fields/TimesFields";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The create form's own state as the shared blocks need it (forgejo#245–#248):
 * what is still missing, which time a server refusal belongs to, and what
 * counts as a change worth asking about. Pure, so it is tested without
 * mounting the form — and so `useFlightForm` (frozen at its size) does not
 * grow by a line.
 */

/** The airport inputs' ids — a label names them, and "Zum Speichern fehlt noch" focuses them. */
export const FLIGHT_FORM_IDS = {
  departureAirport: "flight-form-departure-airport",
  arrivalAirport: "flight-form-arrival-airport",
  /** Prefix of the cost inputs (CostFields): `-price`, `-taxes`, `-fees`. */
  cost: "flight-form-cost",
} as const;

/**
 * A negative price, tax or fee — refused at its field by CostFields; listed
 * here so the line beside the save names it and a click goes there.
 */
export function negativeCostGaps(
  cost: { price?: number; taxes?: number; fees?: number },
  idPrefix: string,
  t: Translate
): MissingStep[] {
  return (["price", "taxes", "fees"] as const)
    .filter((key) => {
      const n = cost[key];
      return n !== undefined && Number.isFinite(n) && n < 0;
    })
    .map((key) => ({ field: `${idPrefix}-${key}`, label: t(`flights:form.missing.${key}`) }));
}

export interface CreateFormFields {
  price?: number;
  taxes?: number;
  fees?: number;
  departure: Airport | null;
  arrival: Airport | null;
  status: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  actualDepartureDate: string;
  actualDepartureTime: string;
  actualArrivalDate: string;
  actualArrivalTime: string;
}

/**
 * What is missing before the flight can be saved, in the order of the form —
 * the same rule as `useFlightForm`'s `canSubmit`, item by item, so the line
 * beside the button names exactly what a click would be refused for.
 */
export function flightCreateGaps(form: CreateFormFields, t: Translate): MissingStep[] {
  const gaps: MissingStep[] = [];
  const add = (field: string, key: string): void => {
    gaps.push({ field, label: t(`flights:form.missing.${key}`) });
  };
  if (!form.departure) add(FLIGHT_FORM_IDS.departureAirport, "departureAirport");
  if (!form.arrival) add(FLIGHT_FORM_IDS.arrivalAirport, "arrivalAirport");
  gaps.push(...negativeCostGaps(form, FLIGHT_FORM_IDS.cost, t));
  if (form.status === "historical") return gaps;
  if (!form.departureDate) add(TIMES_FIELD_DEFAULT_IDS.depDate, "departureDate");
  if (!form.departureTime) add(TIMES_FIELD_DEFAULT_IDS.depTime, "departureTime");
  if (!form.arrivalDate) add(TIMES_FIELD_DEFAULT_IDS.arrDate, "arrivalDate");
  if (!form.arrivalTime) add(TIMES_FIELD_DEFAULT_IDS.arrTime, "arrivalTime");
  if (form.actualDepartureDate && !form.actualDepartureTime) {
    add(TIMES_FIELD_DEFAULT_IDS.actualDepTime, "actualDepartureTime");
  }
  if (form.actualArrivalDate && !form.actualArrivalTime) {
    add(TIMES_FIELD_DEFAULT_IDS.actualArrTime, "actualArrivalTime");
  }
  return gaps;
}

/**
 * A half-filled actual pair, said AT the time that is missing — after a save
 * was tried, not while the user is still typing the date.
 */
export function actualPairErrors(form: CreateFormFields, t: Translate): TimesFieldErrors {
  const missing = t("flights:form.errors.actualTimeMissing");
  return {
    actualDepTime: form.actualDepartureDate && !form.actualDepartureTime ? missing : null,
    actualArrTime: form.actualArrivalDate && !form.actualArrivalTime ? missing : null,
  };
}

/** The server's `field` for a time refusal → the input it belongs to. Unknown fields stay in the banner. */
export const SERVER_TIME_FIELDS: Readonly<Record<string, keyof TimesFieldErrors>> = {
  departureLocal: "depTime",
  arrivalLocal: "arrTime",
  actualDepartureLocal: "actualDepTime",
  actualArrivalLocal: "actualArrTime",
};

/** The user-visible, saved fields — what "changed" means for the discard question (forgejo#248). */
export function flightCreateSnapshot(form: CreateFormFields & Record<string, unknown>): unknown {
  const airport = (a: Airport | null) => (a ? (a.icao ?? a.iata ?? a.name ?? "") : "");
  return {
    lookupNumber: form.flightNumber,
    departure: airport(form.departure),
    arrival: airport(form.arrival),
    times: [
      form.departureDate,
      form.departureTime,
      form.arrivalDate,
      form.arrivalTime,
      form.actualDepartureDate,
      form.actualDepartureTime,
      form.actualArrivalDate,
      form.actualArrivalTime,
    ],
    // Only a status the USER sets. "flown"/"scheduled" follow the date on
    // their own, an effect after the first render — counted, they would make
    // an untouched form ask before closing.
    status: form.status === "historical" || form.status === "cancelled" ? form.status : "",
    rest: [
      "airline",
      "operatingAirline",
      "aircraft",
      "terminal",
      "gate",
      "seatNumber",
      "boardingGroup",
      "seatClass",
      "notes",
      "bookingReference",
      "ticketNumber",
      "bookingClassLetter",
      "baggageAllowance",
      "frequentFlyerNumber",
      "price",
      "currency",
      "taxes",
      "fees",
      "receiptUrl",
      "tripId",
      "category",
      "tags",
      "companions",
      "folds",
    ].map((key) => form[key]),
  };
}

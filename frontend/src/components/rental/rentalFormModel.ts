import { saveErrorKey } from "../../lib/saveErrorMessage";
import { parseDecimalInput } from "../../lib/decimalInput";
import { rentalDrivenKm, type RentalDrivenKm } from "../../shared/rentalCounting";
import type {
  RentalBooking,
  RentalInclusion,
  RentalInput,
  RentalPaymentTiming,
  RentalStationHit,
  RentalStationInput,
} from "../../types/rental";
import {
  NO_DAY_ONLY,
  NO_FOLDS,
  REQUIRED_TIME_ENDS,
  RENTAL_TIME_ENDS,
  foldOf,
  timeShapeOk,
  wallOf,
  wireFold,
  type RentalFold,
  type RentalTimeEnd,
  type RentalTimeFlags,
} from "./rentalFormTimes";

/**
 * The rental form's state and its two translations — from a stored rental,
 * and into the write body (spec 2026-10-01-rental-domain-design §6). Pure, so
 * the rules are tested without a browser.
 */

/** Mirrors `RENTAL_LICENSE_PLATE_MAX` in backend/src/schemas/rental.ts — change both together. */
export const RENTAL_LICENSE_PLATE_MAX = 20;

/** A station as the form holds it. `lat`/`lon` null until something places it. */
export interface RentalStationDraft {
  name: string;
  airportId: number | null;
  iata: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
  /**
   * The station's zone when the pick brought one (an airport, an earlier
   * station, a stored rental) — read only to say beside a time that it meets
   * a clock change; never sent: the server derives the zone itself.
   */
  timezone?: string | null;
}

export const EMPTY_RENTAL_STATION: RentalStationDraft = {
  name: "",
  airportId: null,
  iata: null,
  address: null,
  lat: null,
  lon: null,
  country: null,
  timezone: null,
};

export interface RentalDraft {
  provider: string;
  broker: string;
  confirmationNumber: string;
  pickup: RentalStationDraft;
  /** "Returned at the same station" — ticked by default (§6). */
  sameStation: boolean;
  ret: RentalStationDraft;
  /**
   * `YYYY-MM-DDTHH:mm` on the station's clock — what a datetime-local input
   * holds — or `YYYY-MM-DD` for an end known only by its day (`dayOnly`).
   * The actual hand-overs are optional; empty = nobody recorded them.
   */
  pickupLocal: string;
  returnLocal: string;
  actualPickupLocal: string;
  actualReturnLocal: string;
  dayOnly: RentalTimeFlags<boolean>;
  /** Which occurrence of a repeated autumn hour each clock names; null = the earlier. */
  folds: RentalTimeFlags<RentalFold | null>;
  vehicleClass: string;
  acrissCode: string;
  vehicleExample: string;
  vehicleDriven: string;
  /** Free text; trimmed on the way out, no format check (forgejo#196). */
  licensePlate: string;
  paymentTiming: RentalPaymentTiming | "";
  price: string;
  currency: string;
  inclusions: RentalInclusion[];
  /**
   * A typed km figure is a labelled correction; empty = leave it to the
   * invoice or the odometer. Filled from a stored figure only when that figure
   * IS a correction — an invoice's km loaded here would come back as "user".
   */
  distanceKm: string;
  /** Odometer readings as typed (forgejo#206); empty = not read. */
  odometerOutKm: string;
  odometerInKm: string;
  /** The km figure stored on the rental and its source, as loaded — never edited. */
  storedDistanceKm: number | null;
  storedDistanceSource: string | null;
  arrivalFlightNumber: string;
  notes: string;
  cancelled: boolean;
}

export const EMPTY_RENTAL_DRAFT: RentalDraft = {
  provider: "",
  broker: "",
  confirmationNumber: "",
  pickup: EMPTY_RENTAL_STATION,
  sameStation: true,
  ret: EMPTY_RENTAL_STATION,
  pickupLocal: "",
  returnLocal: "",
  actualPickupLocal: "",
  actualReturnLocal: "",
  dayOnly: NO_DAY_ONLY,
  folds: NO_FOLDS,
  vehicleClass: "",
  acrissCode: "",
  vehicleExample: "",
  vehicleDriven: "",
  licensePlate: "",
  paymentTiming: "",
  price: "",
  currency: "EUR",
  inclusions: [],
  distanceKm: "",
  odometerOutKm: "",
  odometerInKm: "",
  storedDistanceKm: null,
  storedDistanceSource: null,
  arrivalFlightNumber: "",
  notes: "",
  cancelled: false,
};

/** A picked hit carries everything the row needs (silent-failure class 2). */
export function stationFromHit(hit: RentalStationHit): RentalStationDraft {
  return {
    name: hit.name,
    airportId: hit.airportId,
    iata: hit.iata,
    address: hit.address,
    lat: hit.lat,
    lon: hit.lon,
    country: hit.country,
    timezone: hit.timezone,
  };
}

/** Whether the server can place the station: an airport, a position or an address. */
export function isPlaced(s: RentalStationDraft): boolean {
  return (
    s.name.trim() !== "" &&
    (s.airportId !== null || (s.lat !== null && s.lon !== null) || Boolean(s.address?.trim()))
  );
}

function stationOf(r: RentalBooking, end: "pickup" | "return"): RentalStationDraft {
  return end === "pickup"
    ? {
        name: r.pickupStationName,
        airportId: r.pickupAirportId,
        iata: r.pickupIata,
        address: r.pickupAddress,
        lat: r.pickupLat,
        lon: r.pickupLon,
        country: r.pickupCountry,
        timezone: r.pickupTimezone,
      }
    : {
        name: r.returnStationName,
        airportId: r.returnAirportId,
        iata: r.returnIata,
        address: r.returnAddress,
        lat: r.returnLat,
        lon: r.returnLon,
        country: r.returnCountry,
        timezone: r.returnTimezone,
      };
}

/** The form, filled from a stored rental — times on each station's clock, from `times`. */
export function draftFromRental(r: RentalBooking): RentalDraft {
  return {
    provider: r.provider,
    broker: r.broker ?? "",
    confirmationNumber: r.confirmationNumber ?? "",
    pickup: stationOf(r, "pickup"),
    sameStation: !r.oneWay && r.pickupStationName === r.returnStationName,
    ret: stationOf(r, "return"),
    // Each end opens with its own precision and occurrence: a day shown as
    // 00:00 would be saved back as a midnight nobody stated, and 02:30 on the
    // autumn night re-sent without its fold would move by an hour.
    pickupLocal: wallOf(r.times.pickup),
    returnLocal: wallOf(r.times.return),
    actualPickupLocal: wallOf(r.times.actualPickup),
    actualReturnLocal: wallOf(r.times.actualReturn),
    dayOnly: {
      pickup: r.times.pickup?.precision === "day",
      return: r.times.return?.precision === "day",
      actualPickup: r.times.actualPickup?.precision === "day",
      actualReturn: r.times.actualReturn?.precision === "day",
    },
    folds: {
      pickup: foldOf(r.times.pickup),
      return: foldOf(r.times.return),
      actualPickup: foldOf(r.times.actualPickup),
      actualReturn: foldOf(r.times.actualReturn),
    },
    vehicleClass: r.vehicleClass ?? "",
    acrissCode: r.acrissCode ?? "",
    vehicleExample: r.vehicleExample ?? "",
    vehicleDriven: r.vehicleDriven ?? "",
    licensePlate: r.licensePlate ?? "",
    paymentTiming: r.paymentTiming ?? "",
    price: r.price === null ? "" : String(r.price),
    currency: r.currency ?? "EUR",
    inclusions: r.inclusions,
    distanceKm: r.distanceKm !== null && r.distanceSource === "user" ? String(r.distanceKm) : "",
    odometerOutKm: r.odometerOutKm === null ? "" : String(r.odometerOutKm),
    odometerInKm: r.odometerInKm === null ? "" : String(r.odometerInKm),
    storedDistanceKm: r.distanceKm,
    storedDistanceSource: r.distanceSource,
    arrivalFlightNumber: r.arrivalFlightNumber ?? "",
    notes: r.notes ?? "",
    cancelled: r.status === "cancelled",
  };
}

export type RentalFormField =
  | "provider"
  | "pickupStation"
  | "returnStation"
  | "pickupLocal"
  | "returnLocal"
  | "actualPickupLocal"
  | "actualReturnLocal"
  | "price"
  | "distanceKm"
  | "odometerOutKm"
  | "odometerInKm"
  | "acrissCode";

export type RentalDraftErrors = Partial<Record<RentalFormField, string>>;

const ACRISS = /^[A-Za-z]{4}$/;
/** Whole km, bare or grouped in threes by dot, comma or space ("12.634" is twelve thousand). */
const KM_READING = /^(\d+|\d{1,3}([.,\s\u202f]\d{3})+)$/;

/**
 * An odometer reading as typed: null when empty, NaN when it is not a whole
 * number of km. Not `parseDecimalInput` — a dashboard shows "12.634", and a
 * German reader means twelve thousand, not twelve and a bit.
 */
export function parseKmReading(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  return KM_READING.test(value) ? Number(value.replace(/[.,\s\u202f]/g, "")) : Number.NaN;
}
/** The draft's wall clock of one end. */
export const localOf = (d: RentalDraft, end: RentalTimeEnd): string => d[`${end}Local`];

/** Translation keys of what keeps the draft from being saved; empty when it can be. */
export function validateRentalDraft(d: RentalDraft): RentalDraftErrors {
  const errors: RentalDraftErrors = {};
  if (!d.provider.trim()) errors.provider = "rental:form.errors.providerRequired";
  if (!isPlaced(d.pickup)) errors.pickupStation = "rental:form.errors.stationUnplaced";
  if (!d.sameStation && !isPlaced(d.ret))
    errors.returnStation = "rental:form.errors.stationUnplaced";
  for (const end of RENTAL_TIME_ENDS) {
    const required = REQUIRED_TIME_ENDS.includes(end);
    if (!timeShapeOk(localOf(d, end), d.dayOnly[end], required)) {
      errors[`${end}Local`] =
        localOf(d, end) === "" ? "rental:form.errors.timeRequired" : "rental:form.errors.timeShape";
    }
  }
  // Both read through `parseDecimalInput`, so "150,00" is a price (forgejo#163).
  const price = parseDecimalInput(d.price);
  if (price !== null && !(price >= 0)) errors.price = "rental:form.errors.number";
  const km = parseDecimalInput(d.distanceKm);
  if (km !== null && !Number.isInteger(km)) errors.distanceKm = "rental:form.errors.number";
  const out = parseKmReading(d.odometerOutKm);
  const back = parseKmReading(d.odometerInKm);
  if (Number.isNaN(out)) errors.odometerOutKm = "rental:form.errors.number";
  if (Number.isNaN(back)) errors.odometerInKm = "rental:form.errors.number";
  // The server's own check (RENTAL_ODOMETER_REVERSED), said before the save.
  else if (out !== null && back !== null && !Number.isNaN(out) && back < out) {
    errors.odometerInKm = "rental:form.errors.odometerReversed";
  }
  if (d.acrissCode.trim() !== "" && !ACRISS.test(d.acrissCode.trim()))
    errors.acrissCode = "rental:form.errors.acriss";
  return errors;
}

const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());

function stationInput(s: RentalStationDraft): RentalStationInput {
  return {
    name: s.name.trim(),
    airportId: s.airportId,
    address: text(s.address ?? ""),
    ...(s.airportId === null && s.lat !== null && s.lon !== null ? { lat: s.lat, lon: s.lon } : {}),
    country: s.country,
  };
}

/**
 * The km the draft would leave the rental with — the same rule every reader
 * uses (`rentalDrivenKm`): a typed correction, else a stored invoice figure,
 * else in − out of the two readings, else null. What the form shows beside the
 * fields, so the reader sees which figure will count before saving.
 */
export function draftDrivenKm(d: RentalDraft): RentalDrivenKm | null {
  const typed = parseDecimalInput(d.distanceKm);
  const correction = typed !== null && Number.isInteger(typed) && typed >= 0 ? typed : null;
  const keepsStored = d.storedDistanceKm !== null && d.storedDistanceSource !== "user";
  const reading = (raw: string): number | null => {
    const v = parseKmReading(raw);
    return v === null || Number.isNaN(v) ? null : v;
  };
  return rentalDrivenKm({
    distanceKm: correction ?? (keepsStored ? d.storedDistanceKm : null),
    distanceSource: correction !== null ? "user" : keepsStored ? d.storedDistanceSource : null,
    odometerOutKm: reading(d.odometerOutKm),
    odometerInKm: reading(d.odometerInKm),
  });
}

/**
 * The correction as the write body carries it: a typed figure; null when a
 * stored correction was emptied (it is cleared); ABSENT otherwise, so an empty
 * field never wipes the invoice's figure (silent-failure class 4).
 */
function correctionInput(d: RentalDraft): Pick<RentalInput, "distanceKm"> {
  const km = parseDecimalInput(d.distanceKm);
  if (km !== null) return { distanceKm: km };
  return d.storedDistanceSource === "user" && d.storedDistanceKm !== null
    ? { distanceKm: null }
    : {};
}

/**
 * The write body. An empty price is null — unknown, never 0 (§2). A typed km
 * figure goes out as the labelled correction it is; the two odometer readings
 * as whole km, an empty one as null.
 */
export function rentalInputFromDraft(d: RentalDraft): RentalInput {
  const price = parseDecimalInput(d.price);
  return {
    provider: d.provider.trim(),
    broker: text(d.broker),
    confirmationNumber: text(d.confirmationNumber),
    pickupStation: stationInput(d.pickup),
    returnStation: d.sameStation ? null : stationInput(d.ret),
    pickupLocal: d.pickupLocal,
    returnLocal: d.returnLocal,
    pickupFold: wireFold(d.pickupLocal, d.dayOnly.pickup, d.folds.pickup),
    returnFold: wireFold(d.returnLocal, d.dayOnly.return, d.folds.return),
    // Empty = not recorded: sent as null, so emptying the field clears it.
    actualPickupLocal: d.actualPickupLocal === "" ? null : d.actualPickupLocal,
    actualReturnLocal: d.actualReturnLocal === "" ? null : d.actualReturnLocal,
    actualPickupFold: wireFold(d.actualPickupLocal, d.dayOnly.actualPickup, d.folds.actualPickup),
    actualReturnFold: wireFold(d.actualReturnLocal, d.dayOnly.actualReturn, d.folds.actualReturn),
    vehicleClass: text(d.vehicleClass),
    acrissCode: text(d.acrissCode)?.toUpperCase() ?? null,
    vehicleExample: text(d.vehicleExample),
    vehicleDriven: text(d.vehicleDriven),
    licensePlate: text(d.licensePlate),
    paymentTiming: d.paymentTiming === "" ? null : d.paymentTiming,
    price,
    currency: price === null ? null : d.currency,
    inclusions: d.inclusions,
    ...correctionInput(d),
    odometerOutKm: parseKmReading(d.odometerOutKm),
    odometerInKm: parseKmReading(d.odometerInKm),
    arrivalFlightNumber: text(d.arrivalFlightNumber),
    notes: text(d.notes),
    status: d.cancelled ? "cancelled" : "scheduled",
  };
}

/** Rental refusals by their stable code, each to its own sentence (never the server's prose). */
const RENTAL_CODE_KEYS: Readonly<Record<string, string>> = {
  RENTAL_STATION_UNRESOLVED: "rental:form.errors.stationUnresolved",
  RENTAL_GEOCODER_UNAVAILABLE: "rental:form.errors.geocoderUnavailable",
  RENTAL_RETURN_BEFORE_PICKUP: "rental:form.errors.returnBeforePickup",
  RENTAL_ACTUAL_RETURN_BEFORE_PICKUP: "rental:form.errors.actualReturnBeforePickup",
  RENTAL_ODOMETER_REVERSED: "rental:form.errors.odometerReversed",
  RENTAL_ROADTRIP_NOT_FOUND: "rental:form.errors.roadtripNotFound",
  RENTAL_UNKNOWN_BOOKING: "rental:form.errors.unknownBooking",
  RENTAL_INVALID_INPUT: "rental:form.errors.invalid",
  LOCAL_TIME_NONEXISTENT: "rental:form.errors.nonexistentTime",
};

const FIELDS: readonly RentalFormField[] = [
  "provider",
  "pickupStation",
  "returnStation",
  "pickupLocal",
  "returnLocal",
  "actualPickupLocal",
  "actualReturnLocal",
  "price",
  "distanceKm",
  "odometerOutKm",
  "odometerInKm",
  "acrissCode",
];

export interface RentalSaveError {
  key: string;
  field: RentalFormField | null;
}

/** A failed save, read by its `code` and `field`; anything else through the shared rule. */
export function rentalSaveError(err: unknown): RentalSaveError {
  const data = (err as { response?: { data?: { field?: unknown } } })?.response?.data;
  const raw = typeof data?.field === "string" ? data.field : null;
  const field =
    raw && (FIELDS as readonly string[]).includes(raw) ? (raw as RentalFormField) : null;
  return { key: saveErrorKey(err, "rental:form.saveError", RENTAL_CODE_KEYS), field };
}

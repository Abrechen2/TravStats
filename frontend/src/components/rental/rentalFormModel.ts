import { saveErrorKey } from "../../lib/saveErrorMessage";
import type {
  RentalBooking,
  RentalInclusion,
  RentalInput,
  RentalPaymentTiming,
  RentalStationHit,
  RentalStationInput,
} from "../../types/rental";

/**
 * The rental form's state and its two translations — from a stored rental,
 * and into the write body (spec 2026-10-01-rental-domain-design §6). Pure, so
 * the rules are tested without a browser.
 */

/** A station as the form holds it. `lat`/`lon` null until something places it. */
export interface RentalStationDraft {
  name: string;
  airportId: number | null;
  iata: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export const EMPTY_RENTAL_STATION: RentalStationDraft = {
  name: "",
  airportId: null,
  iata: null,
  address: null,
  lat: null,
  lon: null,
  country: null,
};

export interface RentalDraft {
  provider: string;
  broker: string;
  confirmationNumber: string;
  pickup: RentalStationDraft;
  /** "Returned at the same station" — ticked by default (§6). */
  sameStation: boolean;
  ret: RentalStationDraft;
  /** `YYYY-MM-DDTHH:mm` on the station's clock — what a datetime-local input holds. */
  pickupLocal: string;
  returnLocal: string;
  vehicleClass: string;
  acrissCode: string;
  vehicleExample: string;
  vehicleDriven: string;
  paymentTiming: RentalPaymentTiming | "";
  price: string;
  currency: string;
  inclusions: RentalInclusion[];
  /** A typed km figure is a labelled correction; empty = leave it to the invoice. */
  distanceKm: string;
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
  vehicleClass: "",
  acrissCode: "",
  vehicleExample: "",
  vehicleDriven: "",
  paymentTiming: "",
  price: "",
  currency: "EUR",
  inclusions: [],
  distanceKm: "",
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
      }
    : {
        name: r.returnStationName,
        airportId: r.returnAirportId,
        iata: r.returnIata,
        address: r.returnAddress,
        lat: r.returnLat,
        lon: r.returnLon,
        country: r.returnCountry,
      };
}

const wall = (value: { local: string } | null, precision: string): string =>
  value ? (precision === "day" ? value.local.slice(0, 10) : value.local.slice(0, 16)) : "";

/** The form, filled from a stored rental — times on each station's clock, from `times`. */
export function draftFromRental(r: RentalBooking): RentalDraft {
  return {
    provider: r.provider,
    broker: r.broker ?? "",
    confirmationNumber: r.confirmationNumber ?? "",
    pickup: stationOf(r, "pickup"),
    sameStation: !r.oneWay && r.pickupStationName === r.returnStationName,
    ret: stationOf(r, "return"),
    pickupLocal: wall(r.times.pickup, r.pickupPrecision),
    returnLocal: wall(r.times.return, r.returnPrecision),
    vehicleClass: r.vehicleClass ?? "",
    acrissCode: r.acrissCode ?? "",
    vehicleExample: r.vehicleExample ?? "",
    vehicleDriven: r.vehicleDriven ?? "",
    paymentTiming: r.paymentTiming ?? "",
    price: r.price === null ? "" : String(r.price),
    currency: r.currency ?? "EUR",
    inclusions: r.inclusions,
    distanceKm: r.distanceKm === null ? "" : String(r.distanceKm),
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
  | "price"
  | "distanceKm"
  | "acrissCode";

export type RentalDraftErrors = Partial<Record<RentalFormField, string>>;

const ACRISS = /^[A-Za-z]{4}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Translation keys of what keeps the draft from being saved; empty when it can be. */
export function validateRentalDraft(d: RentalDraft): RentalDraftErrors {
  const errors: RentalDraftErrors = {};
  if (!d.provider.trim()) errors.provider = "rental:form.errors.providerRequired";
  if (!isPlaced(d.pickup)) errors.pickupStation = "rental:form.errors.stationUnplaced";
  if (!d.sameStation && !isPlaced(d.ret))
    errors.returnStation = "rental:form.errors.stationUnplaced";
  if (!LOCAL.test(d.pickupLocal)) errors.pickupLocal = "rental:form.errors.timeRequired";
  if (!LOCAL.test(d.returnLocal)) errors.returnLocal = "rental:form.errors.timeRequired";
  if (d.price.trim() !== "" && !(Number(d.price) >= 0)) errors.price = "rental:form.errors.number";
  if (d.distanceKm.trim() !== "" && !Number.isInteger(Number(d.distanceKm)))
    errors.distanceKm = "rental:form.errors.number";
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
 * The write body. An empty price is null — unknown, never 0 (§2). A typed km
 * figure goes out as the labelled correction it is.
 */
export function rentalInputFromDraft(d: RentalDraft): RentalInput {
  const price = text(d.price);
  const km = text(d.distanceKm);
  return {
    provider: d.provider.trim(),
    broker: text(d.broker),
    confirmationNumber: text(d.confirmationNumber),
    pickupStation: stationInput(d.pickup),
    returnStation: d.sameStation ? null : stationInput(d.ret),
    pickupLocal: d.pickupLocal,
    returnLocal: d.returnLocal,
    vehicleClass: text(d.vehicleClass),
    acrissCode: text(d.acrissCode)?.toUpperCase() ?? null,
    vehicleExample: text(d.vehicleExample),
    vehicleDriven: text(d.vehicleDriven),
    paymentTiming: d.paymentTiming === "" ? null : d.paymentTiming,
    price: price === null ? null : Number(price),
    currency: price === null ? null : d.currency,
    inclusions: d.inclusions,
    distanceKm: km === null ? null : Number(km),
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
  RENTAL_ROADTRIP_NOT_FOUND: "rental:form.errors.roadtripNotFound",
  RENTAL_INVALID_INPUT: "rental:form.errors.invalid",
  LOCAL_TIME_NONEXISTENT: "rental:form.errors.nonexistentTime",
};

const FIELDS: readonly RentalFormField[] = [
  "provider",
  "pickupStation",
  "returnStation",
  "pickupLocal",
  "returnLocal",
  "price",
  "distanceKm",
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

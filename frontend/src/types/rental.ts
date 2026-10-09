import type { TimeValue } from "../shared/time";

/**
 * Car rentals — spec docs/superpowers/specs/2026-10-01-rental-domain-design.md.
 * Mirrors the `RentalBooking` schema of `GET /api/v1/rentals` (OpenAPI).
 */

export type RentalStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type RentalPaymentTiming = "prepaid" | "pay_at_counter" | "package";
export type RentalMileagePolicy = "unlimited" | "capped";
export type RentalFuelPolicy = "full_to_full" | "prepaid_tank" | "full_to_empty";
export type RentalDistanceSource = "invoice" | "agreement" | "user";

export const RENTAL_INCLUSIONS = [
  "cdw",
  "tp",
  "scdw",
  "pai",
  "slp",
  "ep",
  "roadside",
  "gps",
  "child_seat",
  "additional_driver",
  "one_way_fee",
] as const;
export type RentalInclusion = (typeof RENTAL_INCLUSIONS)[number];

/** Booked and actual times, each on its station's clock (ADR 0002 D3). */
export interface RentalTimes {
  pickup: TimeValue | null;
  return: TimeValue | null;
  actualPickup: TimeValue | null;
  actualReturn: TimeValue | null;
}

export interface RentalBooking {
  id: string;
  provider: string;
  operatedBy: string | null;
  broker: string | null;
  confirmationNumber: string | null;
  brokerReference: string | null;
  agreementNumber: string | null;
  invoiceNumber: string | null;
  pickupStationName: string;
  pickupAddress: string | null;
  pickupAirportId: number | null;
  pickupIata: string | null;
  pickupLat: number;
  pickupLon: number;
  pickupCountry: string | null;
  pickupTimezone: string;
  returnStationName: string;
  returnAddress: string | null;
  returnAirportId: number | null;
  returnIata: string | null;
  returnLat: number;
  returnLon: number;
  returnCountry: string | null;
  returnTimezone: string;
  pickupPrecision: string;
  returnPrecision: string;
  vehicleClass: string | null;
  acrissCode: string | null;
  vehicleTraits: { transmission: "manual" | "automatic"; airConditioning: boolean } | null;
  vehicleExample: string | null;
  vehicleDriven: string | null;
  /** Free text as typed (forgejo#196); null = not recorded. */
  licensePlate: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  /** Driven km — from the invoice or a labelled correction; null = unknown. */
  distanceKm: number | null;
  distanceSource: RentalDistanceSource | null;
  finalAmount: number | null;
  finalCurrency: string | null;
  /** `cancellationFee`: the fee a cancelled rental was billed — never a rental-day cost. */
  finalAmountSource: "invoice" | "user" | "cancellationFee" | null;
  /** Send time of the newest provider mail applied; an older one only fills gaps. */
  lastMailSentAt: string | null;
  mileagePolicy: RentalMileagePolicy | null;
  mileageCapKm: number | null;
  fuelPolicy: RentalFuelPolicy | null;
  paymentTiming: RentalPaymentTiming | null;
  price: number | null;
  currency: string | null;
  inclusions: RentalInclusion[];
  arrivalFlightNumber: string | null;
  status: RentalStatus;
  notes: string | null;
  tags: string[];
  companions: string[];
  userEditedFields: string[];
  tripId: string | null;
  routeId: string | null;
  externalRef: string | null;
  oneWay: boolean;
  rentalDays: number;
  cost: {
    amount: number;
    currency: string;
    source: "final" | "booked" | "cancellationFee";
  } | null;
  /** Where the booked `price` came from — the booking mail, or typed; null without a price. */
  priceSource: "booking" | "user" | null;
  /** Returned, and no km from an invoice or a correction yet (D11 b). */
  invoiceMissing: boolean;
  trip?: { id: string; name: string; color: string } | null;
  route?: { id: string; name: string | null } | null;
  times: RentalTimes;
  createdAt: string;
  updatedAt: string;
}

/** A station as the write body names it — the server places it (§3.2). */
export interface RentalStationInput {
  airportId?: number | null;
  iata?: string | null;
  name: string;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
}

export interface RentalInput {
  provider: string;
  operatedBy?: string | null;
  broker?: string | null;
  confirmationNumber?: string | null;
  brokerReference?: string | null;
  pickupStation: RentalStationInput;
  returnStation?: RentalStationInput | null;
  pickupLocal: string;
  returnLocal: string;
  pickupFold?: "earlier" | "later" | null;
  returnFold?: "earlier" | "later" | null;
  /** The actual hand-overs, a wall clock or a day on each station's clock; null clears one. */
  actualPickupLocal?: string | null;
  actualReturnLocal?: string | null;
  actualPickupFold?: "earlier" | "later" | null;
  actualReturnFold?: "earlier" | "later" | null;
  vehicleClass?: string | null;
  acrissCode?: string | null;
  vehicleExample?: string | null;
  vehicleDriven?: string | null;
  licensePlate?: string | null;
  distanceKm?: number | null;
  /** Odometer readings, km (forgejo#206); null clears one. Return ≥ pick-up. */
  odometerOutKm?: number | null;
  odometerInKm?: number | null;
  paymentTiming?: RentalPaymentTiming | null;
  price?: number | null;
  currency?: string | null;
  /** A labelled correction of the invoice's amount; absent leaves the stored one. */
  finalAmount?: number | null;
  finalCurrency?: string | null;
  invoiceNumber?: string | null;
  fuelPolicy?: RentalFuelPolicy | null;
  inclusions?: RentalInclusion[];
  arrivalFlightNumber?: string | null;
  status?: "scheduled" | "cancelled";
  notes?: string | null;
  tripId?: string | null;
  routeId?: string | null;
}

/** One hit of `GET /rentals/stations`. */
export interface RentalStationHit {
  kind: "airport" | "earlier";
  airportId: number | null;
  iata: string | null;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
}

/** Why a rental document was not read — a stable code the review words (backend `RentalFallbackCode`). */
export type RentalParseFallbackCode =
  "parking" | "noItinerary" | "noTemplate" | "notConfirmed" | "otherDomain" | "unknownBooking";

export interface AirportHit {
  airportId: number;
  iata: string;
  name: string;
  country: string | null;
}

export type StationResolution =
  | { status: "resolved"; airport: AirportHit }
  | { status: "ambiguous"; candidates: AirportHit[] }
  | {
      status: "geocoded";
      place: { label: string; lat: number; lon: number; country: string | null };
    }
  | { status: "unresolved"; geocoderUnavailable?: true };

export interface RentalInvoiceReading {
  provider: string;
  confirmationNumber: string | null;
  agreementNumber: string | null;
  invoiceNumber: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  distanceKm: number | null;
  vehicleDriven: string | null;
  actualPickupLocal: string | null;
  actualReturnLocal: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
}

/** One reviewed document, as `POST /parse-*` with domain `rental` answers it. */
export interface RentalImportCandidate {
  kind: "confirmation" | "cancellation" | "invoice";
  action: "create" | "update" | "cancel" | "invoice" | "declined";
  declineCode: "unknownBooking" | null;
  existingId: string | null;
  parserTemplate: string;
  input: (RentalInput & { mileagePolicy?: RentalMileagePolicy | null }) | null;
  stations: { pickup: StationResolution; return: StationResolution } | null;
  invoice: RentalInvoiceReading | null;
  /** The fee a cancellation bills; it becomes the cancelled rental's cost. */
  cancellationFee: { amount: number; currency: string } | null;
  confirmationNumber: string | null;
  provider: string;
  /** The mail's own send time (ISO), sent back so the newer mail's data stands. */
  mailSentAt: string | null;
}

/** A rental as `GET /trips/:id` carries it — the timeline's two ends. */
export interface TripRental {
  id: string;
  provider: string;
  pickupStationName: string;
  returnStationName: string;
  pickupTime: string;
  returnTime: string;
  pickupTimezone: string;
  returnTimezone: string;
  pickupPrecision: string;
  returnPrecision: string;
  status: RentalStatus;
}

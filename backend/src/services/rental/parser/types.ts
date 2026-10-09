import type { RENTAL_INCLUSIONS, RENTAL_PAYMENT_TIMINGS } from "../../../schemas/rental";

/**
 * What a rental reader takes out of a document — before any station is
 * placed (spec 2026-10-01-rental-domain-design §4). Every field is what the
 * document PRINTS; a value it does not print is null, never a guess.
 */

/**
 * Which reader produced a document: the template's short name
 * (`sixt-confirmation`, `sixt-invoice` — plan 2026-10-09 P4b moved the
 * provider readers into the template repository, so the set is open).
 */
export type RentalParseSource = string;

/** One end as printed: the station's name and its wall clock. */
export interface ParsedRentalEnd {
  stationName: string;
  /** `YYYY-MM-DDTHH:mm` on the station's clock, or `YYYY-MM-DD` without an hour. */
  local: string;
}

export interface ParsedRentalConfirmation {
  kind: "confirmation";
  source: RentalParseSource;
  provider: string;
  confirmationNumber: string;
  pickup: ParsedRentalEnd;
  return: ParsedRentalEnd;
  vehicleClass: string | null;
  vehicleExample: string | null;
  acrissCode: string | null;
  paymentTiming: (typeof RENTAL_PAYMENT_TIMINGS)[number] | null;
  price: number | null;
  currency: string | null;
  mileagePolicy: "unlimited" | "capped" | null;
  inclusions: Array<(typeof RENTAL_INCLUSIONS)[number]>;
  /**
   * Where the document says the station is, beyond its name: an ISO country
   * the mail carries, and airport phrases in its prose ("Aéroport de X").
   * Read by station resolution only — never stored.
   */
  placeHints: { country: string | null; airportWords: string[] };
}

/** A change or a cancellation names a booking by its number — and never creates one. */
export interface ParsedRentalCancellation {
  kind: "cancellation";
  source: RentalParseSource;
  provider: string;
  confirmationNumber: string;
  /**
   * The cancellation fee a provider bills for it, when the document prints
   * one ("Stornogebühr"). Stored as the cancelled rental's cost, flagged as a
   * fee — never a rental-day cost. Null when no fee is printed.
   */
  fee: { amount: number; currency: string } | null;
}

/**
 * A final invoice (§4.5): the only source of driven km, the car actually
 * driven and the amount charged. It matches a booking by number and never
 * creates one.
 */
export interface ParsedRentalInvoice {
  kind: "invoice";
  source: RentalParseSource;
  provider: string;
  confirmationNumber: string | null;
  agreementNumber: string | null;
  invoiceNumber: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  /** The invoice's own driven-km figure when it prints one. */
  distanceKm: number | null;
  vehicleDriven: string | null;
  /** `YYYY-MM-DDTHH:mm` on the return station's clock. */
  actualReturnLocal: string | null;
  actualPickupLocal: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
}

export type ParsedRentalDocument =
  ParsedRentalConfirmation | ParsedRentalCancellation | ParsedRentalInvoice;

/**
 * What a lodging reader produces, and the two generic readers every lodging
 * path shares — German dates and price-line currency symbols.
 *
 * These lived in the compiled-in Booking.com reader until plan 2026-10-09 P4b
 * moved that reader into the template repository (`lodging/bookingcom.json`).
 * Nothing here names an issuer.
 */
import { type CurrencyCode } from "../../shared/currencies";
import type { LodgingBoard } from "./lodgingFieldNormalization";
import type { LODGING_TYPES } from "../../schemas/lodging";
import { CURRENCY_SYMBOLS as SYMBOLS } from "../parsers/templates/v2/vocabularyTransforms";
import { splitAddressLine, type AddressParts } from "../parsers/templates/v2/addressParts";

type LodgingType = (typeof LODGING_TYPES)[number];

export type LodgingCurrency = CurrencyCode;

export interface ParsedLodgingBooking {
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCategory: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  totalPrice: number | null;
  /** Per-night rate as printed. 47 % of real confirmations state one. */
  pricePerNight: number | null;
  currency: LodgingCurrency | null;
  /** Meal plan as printed, mapped onto BOARD_TYPES. 61 % state one. */
  board: LodgingBoard | null;
  /**
   * How many people the booking covers. 42 % of confirmations state it.
   * A COUNT only — a confirmation names the booker, never the companion, so
   * the name stays the user's to supply.
   */
  guests: number | null;
  /** What kind of place: a KOA is a campsite, not a hotel. Null = unjudged. */
  type: LodgingType | null;
  /** The group behind the brand — "Courtyard by Marriott" -> "Marriott". */
  chainName: string | null;
  confirmationNumber: string | null;
  parserTemplate: string;
  parserConfidence: number;
  missing: string[];
}

/**
 * Currency symbols a price line prints in front of the amount (the dollar
 * family with its country prefix: "US$", "S$"). Three-letter codes are
 * resolved against ISO 4217 instead, so this table never has to grow.
 */
export const CURRENCY_SYMBOLS = SYMBOLS as Readonly<Record<string, LodgingCurrency>>;

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

/**
 * "Mittwoch, 26. Juni 2024" — and "Samstag, 26 November 2022", the same
 * sender writing the same field without the ordinal dot → "2024-06-26".
 *
 * The shape stays tight: a 1-2 digit day, a word that must be a German month,
 * a four-digit year — and a day the calendar has ("31 April 2026" is no date;
 * `Date.parse` would quietly normalise it to the first of May).
 */
export function parseGermanDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(\d{1,2})\.?\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/);
  if (!m) return null;
  const month = GERMAN_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * "Zilverstraat 6, 2718 RL Zoetermeer, Niederlande" → street, postcode, city,
 * country. The rules are postal formats, shared with the template engine's
 * `address*` transforms (`v2/addressParts.ts`).
 */
export function parseLage(raw: string | null): AddressParts {
  return splitAddressLine(raw);
}

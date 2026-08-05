/**
 * BCBP Helper Types and Utility Functions
 *
 * Shared types and utilities used by all boarding pass parsers.
 * Lives inside airline-parsers/ to avoid circular imports:
 *   bcbpParser.ts → airline-parsers/index.ts → (parsers) → bcbpHelpers.ts
 *                                                          ↑ no back-reference
 */

import { logger } from "../logger";
import { resolveAirlineDisplay } from "../airlineUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoardingPassData {
  formatCode: string;
  numberOfLegs: number;
  passengerName: string;
  electronicTicketIndicator: string;

  // Per-leg data (we focus on first leg)
  operatingCarrierPNR: string;
  departureAirport: string;
  arrivalAirport: string;
  operatingCarrierDesignator: string;
  flightNumber: string;
  dateOfFlight: string; // JULIAN DATE (DDD = day of year)
  compartmentCode: string;
  seatNumber: string;
  checkInSequenceNumber: string;
  passengerStatus: string;
  seatClass?: "economy" | "premium_economy" | "business" | "first";
  airlineName?: string;

  // Conditional data (if present)
  airlineNumericCode?: string;
  documentSerialNumber?: string;
  selecteeIndicator?: string;
  internationalDocumentationVerification?: string;
  marketingCarrier?: string;
  frequentFlyerNumber?: string;

  // Extended data from conditional/security sections
  gate?: string;
  terminal?: string;
  boardingTime?: string; // HH:MM format

  // Raw data for debugging
  raw: string;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Convert Julian date (day of year) to ISO date string
 * Smart year detection: assumes current year, but adjusts if date seems wrong
 *
 * @internal - Used by parser classes
 */
export function julianDateToDate(julianDate: string): string {
  const dayOfYear = parseInt(julianDate, 10);
  logger.debug("Julian day conversion: Input day of year =", dayOfYear);

  const year = new Date().getFullYear();
  logger.debug("Current year:", year);

  // Create date from day of year using UTC to avoid timezone issues
  const date = new Date(Date.UTC(year, 0, dayOfYear));

  logger.debug("Calculated date (before year adjustment):", date.toISOString().split("T")[0]);

  // Calculate days difference from today
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  logger.debug("Days difference from today:", diffDays);

  // Year adjustment logic:
  // - If date is far in the FUTURE (>300 days), it's probably from LAST year
  // - If date is in the past, keep current year (boarding passes from earlier this year)
  let adjustedYear = year;

  if (diffDays > 300) {
    // Date is way in the future (e.g., day 158 when we're at day 333)
    // This means it's actually from last year
    adjustedYear = year - 1;
    logger.debug("Date is >300 days in future, assuming PREVIOUS year");
  } else if (diffDays < -180) {
    // Date is more than 180 days in the past — it must belong to next year
    // (e.g., scanning a December boarding pass in January: day 335 looks ~330 days ago)
    adjustedYear = year + 1;
    logger.debug("Date is >180 days in past, assuming NEXT year");
  } else {
    // Date is reasonable (within ±180–300 days) - keep current year
    logger.debug("Date is within reasonable range, keeping current year");
  }

  // Recalculate with adjusted year
  const finalDate = new Date(Date.UTC(adjustedYear, 0, dayOfYear));
  const result = finalDate.toISOString().split("T")[0];
  logger.debug("Final converted date:", result);
  return result; // Return YYYY-MM-DD
}

/**
 * Map compartment code to seat class
 * @internal - Used by parser classes
 */
export function mapCompartmentToSeatClass(
  code: string
): "economy" | "premium_economy" | "business" | "first" | null {
  if (!code || code.trim().length === 0) return null;
  const c = code.trim().toUpperCase();
  if ("FAP".includes(c)) return "first";
  if ("CJDZ".includes(c)) return "business";
  if ("WPE".includes(c)) return "premium_economy";
  return "economy";
}

/**
 * Get airline name from an IATA code, resolved against the shared
 * `AIRLINE_CATALOG` (`../airlineUtils`) instead of a hand-typed table.
 * Falls back to the raw code when the catalogue has no match, matching
 * the previous behavior of the hardcoded map.
 */
export function getAirlineName(iataCode: string): string {
  return resolveAirlineDisplay({ airlineIata: iataCode }) ?? iataCode;
}

/**
 * IATA Bar Coded Boarding Pass (BCBP) Parser
 *
 * Parses the standardized IATA barcode format found on boarding passes.
 * Format: https://www.iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf
 */

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

// Import registry-based parser system
import { parseBCBP as parseBCBPFromRegistry } from "./airline-parsers";
import { logger } from "./logger";

/**
 * Enhanced parser that tries multiple boarding pass formats
 *
 * ARCHITECTURE: Registry Pattern with Strategy Interface
 * All parsers are registered in the registry and executed by priority.
 * This allows us to support any airline without duplicating scanner code.
 */
export function parseBCBP(barcodeData: string): BoardingPassData | null {
  logger.debug("[BCBP Parser] Raw barcode data:", barcodeData);
  logger.debug("[BCBP Parser] Length:", barcodeData.length, "chars");

  // Use registry-based parser system
  const result = parseBCBPFromRegistry(barcodeData);

  if (result) {
    logger.debug("[BCBP Parser] Parsing successful");
    logger.debug("[BCBP Parser] Parsed date:", result.dateOfFlight);
    logger.debug(
      "[BCBP Parser] Airline:",
      result.operatingCarrierDesignator,
      "-",
      result.airlineName
    );
    logger.debug("[BCBP Parser] Flight:", result.flightNumber);
  } else {
    logger.error("[BCBP Parser] All parsing methods failed");
  }

  return result;
}

// Old parser functions have been moved to separate parser classes in airline-parsers/
// Use parseBCBP() which delegates to the registry system.

// Helper functions (exported for use by other modules)

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
  } else if (diffDays < -365) {
    // Date is more than a year in the past - keep current year
    logger.debug("Date is >365 days in past, keeping current year");
  } else {
    // Date is reasonable (within ±300 days) - keep current year
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
): "economy" | "premium_economy" | "business" | "first" {
  const c = code.toUpperCase();
  if ("FAP".includes(c)) return "first";
  if ("CJDZ".includes(c)) return "business";
  if ("WPE".includes(c)) return "premium_economy";
  return "economy";
}

/**
 * Get airline name from IATA code (common airlines)
 */
export function getAirlineName(iataCode: string): string {
  const airlines: Record<string, string> = {
    LH: "Lufthansa",
    EN: "AirDolomiti",
    BA: "British Airways",
    AF: "Air France",
    KL: "KLM",
    LX: "Swiss",
    OS: "Austrian Airlines",
    SN: "Brussels Airlines",
    SK: "SAS Scandinavian Airlines",
    AY: "Finnair",
    TP: "TAP Air Portugal",
    IB: "Iberia",
    VY: "Vueling",
    FR: "Ryanair",
    U2: "easyJet",
    W6: "Wizz Air",
    EW: "Eurowings",
    UA: "United Airlines",
    AA: "American Airlines",
    DL: "Delta Air Lines",
    WN: "Southwest Airlines",
    B6: "JetBlue",
    AC: "Air Canada",
    EK: "Emirates",
    QR: "Qatar Airways",
    TK: "Turkish Airlines",
    SQ: "Singapore Airlines",
    CX: "Cathay Pacific",
    NH: "ANA",
    JL: "Japan Airlines",
  };

  return airlines[iataCode] || iataCode;
}

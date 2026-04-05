/**
 * IATA Bar Coded Boarding Pass (BCBP) Parser
 *
 * Parses the standardized IATA barcode format found on boarding passes.
 * Format: https://www.iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf
 *
 * Types and helper utilities live in ./airline-parsers/bcbpHelpers to break the
 * circular dependency:
 *   bcbpParser → airline-parsers/index → parsers → bcbpHelpers  (no cycle)
 */

// Re-export shared types and helpers so existing consumers of this module are unaffected.
export type { BoardingPassData } from "./airline-parsers/bcbpHelpers";
export {
  julianDateToDate,
  mapCompartmentToSeatClass,
  getAirlineName,
} from "./airline-parsers/bcbpHelpers";

import { BoardingPassData } from "./airline-parsers/bcbpHelpers";
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

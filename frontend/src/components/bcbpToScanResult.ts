import type { BoardingPassData } from "../lib/airline-parsers/bcbpHelpers";
import type { ScanResultData } from "./BoardingPassScanner.types";

/**
 * Map a parsed BCBP barcode payload onto the scanner's `ScanResultData` shape.
 *
 * BCBP barcodes carry a Julian day-of-year (DDD) but never a year — the year
 * is always heuristically inferred at parse time (see `julianDateToDate`).
 * That inference is silent at the data layer, so the scanner must surface it
 * to the import-review UI via `inferredFields: ["departureTime"]`, which
 * triggers the yellow "please verify" badge in `FlightReviewModal`.
 *
 * Pure function — no React, no side effects — so it can be unit-tested in
 * isolation from the scanner component.
 */
/** "012A" -> "12A": BCBP pads the seat row to three digits. Empty stays absent. */
function reviewSeat(raw: string): string | undefined {
  const seat = raw.trim().replace(/^0+(?=\d)/, "");
  return seat === "" ? undefined : seat;
}

export function bcbpToScanResult(parsedData: BoardingPassData): ScanResultData {
  const seat = reviewSeat(parsedData.seatNumber);
  const pnr = parsedData.operatingCarrierPNR.trim();
  return {
    // The review reads `seat` and `pnr` (forgejo#172: both were lost here,
    // although the barcode carried them).
    ...(seat !== undefined ? { seat } : {}),
    ...(pnr !== "" ? { pnr } : {}),
    flightNumber: `${parsedData.operatingCarrierDesignator}${parsedData.flightNumber}`,
    departureCode: parsedData.departureAirport,
    arrivalCode: parsedData.arrivalAirport,
    departureTime: parsedData.dateOfFlight,
    seatNumber: parsedData.seatNumber,
    seatClass: parsedData.seatClass || "economy",
    airline: parsedData.airlineName || parsedData.operatingCarrierDesignator,
    // BCBP barcodes never carry a year, so the date is always inferred.
    inferredFields: ["departureTime"],
  };
}

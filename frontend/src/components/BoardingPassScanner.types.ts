import type { ParsedBooking } from "../types";

/**
 * Result shape emitted by `BoardingPassScanner.onScanSuccess`.
 *
 * Extends `ParsedBooking` (so review modals see the full set of import-review
 * fields, including `inferredFields`) and adds `seatNumber` for the boarding-
 * pass-specific seat field.
 *
 * Lives in its own file so pure helpers (e.g. `bcbpToScanResult`) can import
 * the type without dragging the React component into their dependency graph.
 */
export interface ScanResultData extends ParsedBooking {
  seatNumber?: string;
}

/**
 * PNR (Passenger Name Record) extraction logic for the regex parser.
 * Handles labelled PNR fields and generic 6-char alphanumeric scanning.
 */

import { PNR_FALSE_POSITIVES } from './regexMappings';

/**
 * Find the first PNR candidate in an already-uppercased source string.
 * A PNR is a 6-char alphanumeric token that contains at least one digit
 * and is not a known German false-positive word.
 */
export function findPNRInSource(sourceUpper: string): string | undefined {
  for (const match of sourceUpper.matchAll(/\b([A-Z0-9]{6})\b/g)) {
    const pnr = match[1];
    if (!PNR_FALSE_POSITIVES.has(pnr) && /[0-9]/.test(pnr)) {
      return pnr;
    }
  }
  return undefined;
}

/** Extract shared PNR (should be same for all flights in one booking) */
export function extractSharedPNR(source: string): string | undefined {
  // Label-based extraction first (more reliable) — covers both old and new Lufthansa formats
  const labeledPnr = source.match(
    /(?:Buchungsreferenz|Buchungscode|Booking\s*(?:Reference|Code)|PNR|Confirmation\s*(?:Number|Code))\s*:?\s*([A-Z0-9]{5,8})\b/i
  );
  if (labeledPnr) return labeledPnr[1].toUpperCase();
  return findPNRInSource(source.toUpperCase());
}

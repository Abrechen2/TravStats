/**
 * What kind of cabin a piece of text names — the ONE place that maps prose
 * ("Innenkabine", "Junior Suite Balkon", "Meerblick") onto the four values the
 * cruise schema stores.
 *
 * Two callers read cabins from text people wrote: the TUI confirmation reader
 * (a category line of a PDF) and the spreadsheet import (a cell someone typed,
 * or an older export that still carried free text). They must agree, or the
 * same word would be a balcony in one and refused in the other.
 */

import { CABIN_TYPES } from "../../schemas/cruise";
import type { CruiseCabinType } from "../cruiseBookingParser";

/**
 * The type a cabin CATEGORY names, or undefined when it names none.
 *
 * Suite wins over balcony where both words appear — a "Junior Suite Balkon" is
 * a suite with a balcony, and the type field records the category that was
 * paid for, which is the more specific one.
 */
export function cabinTypeFromCategory(category: string): CruiseCabinType | undefined {
  const text = category.toLowerCase();
  if (/\bsuite\b/.test(text)) return "suite";
  if (/balkon|veranda/.test(text)) return "balcony";
  if (/außen|aussen|meerblick|ocean/.test(text)) return "oceanview";
  if (/innen/.test(text)) return "inside";
  return undefined;
}

/**
 * A stored value first (any case — "Balcony" is what a hand-typed cell looks
 * like), then the category reading. Undefined when neither knows the text:
 * the caller leaves the field empty rather than guessing the commonest cabin.
 */
export function toCabinType(value: string): CruiseCabinType | undefined {
  const lower = value.trim().toLowerCase();
  const stored = CABIN_TYPES.find((t) => t === lower);
  return stored ?? cabinTypeFromCategory(lower);
}

/**
 * "Werte aus dem Beleg übernehmen" — the shapes of
 * `POST /documents/:id/extract-values` and the one rule the preview applies:
 * a value the parser found is PRE-TICKED only where the entry's field is empty.
 * A filled field is still offered, unticked, so the user can overwrite it on
 * purpose — never by default.
 */

export const EXTRACT_FIELDS = [
  "price",
  "currency",
  "bookingReference",
  "seatNumber",
  "seatClass",
] as const;
export type ExtractField = (typeof EXTRACT_FIELDS)[number];

export type ExtractDomain = "flight" | "cruise" | "lodging";
export type ExtractedSeatClass = "economy" | "premium_economy" | "business" | "first";

export interface ExtractedValues {
  price: number | null;
  currency: string | null;
  bookingReference: string | null;
  seatNumber: string | null;
  seatClass: ExtractedSeatClass | null;
}

export interface ExtractValuesRequest {
  domain: ExtractDomain;
  flightNumber?: string;
  departureDate?: string;
}

export interface ExtractValuesResult {
  domain: ExtractDomain;
  parserUsed: string | null;
  values: ExtractedValues | null;
  reason: "noText" | "nothingFound" | null;
}

/** What the entry holds now. A field absent from this object is not offered at all. */
export type CurrentValues = Partial<Record<ExtractField, string | number | null | undefined>>;

/** Where extracted values go: the entry's domain, its current values, and how to write them. */
export interface ExtractTarget {
  domain: ExtractDomain;
  flightNumber?: string;
  departureDate?: string;
  current: CurrentValues;
  onApply: (values: Partial<ExtractedValues>) => void | Promise<void>;
}

const isEmpty = (value: string | number | null | undefined): boolean =>
  value === null || value === undefined || value === "" || value === 0;

/**
 * The fields worth a row in the preview: found by the parser, held by the
 * entry, and different from what it holds already.
 */
export function offeredFields(values: ExtractedValues, current: CurrentValues): ExtractField[] {
  return EXTRACT_FIELDS.filter((field) => {
    if (!(field in current)) return false;
    const found = values[field];
    if (found === null) return false;
    const held = current[field];
    if (isEmpty(held)) return true;
    // A form holds its amount as typed text ("412.80"), a stored entry as a number.
    return typeof found === "number"
      ? Number(held) !== found
      : found.toUpperCase() !== String(held).trim().toUpperCase();
  });
}

/**
 * The rows ticked when the preview opens: those whose field is empty.
 *
 * The currency is the exception that makes the rule honest. A form always
 * shows one — it defaults to EUR — so "empty" can never be read off it; a
 * currency next to NO price is a default nobody chose, and counts as empty.
 */
export function initialSelection(
  offered: readonly ExtractField[],
  current: CurrentValues
): ExtractField[] {
  return offered.filter((field) =>
    field === "currency"
      ? isEmpty(current.currency) || isEmpty(current.price)
      : isEmpty(current[field])
  );
}

/** The ticked values, ready for the entry's own update. */
export function pickValues(
  values: ExtractedValues,
  selected: readonly ExtractField[]
): Partial<ExtractedValues> {
  return Object.fromEntries(selected.map((field) => [field, values[field]]));
}

/** The id inside a receipt URL (`/api/v1/documents/<id>/file`), or null for a legacy upload. */
export function documentIdFromUrl(url: string | null | undefined): string | null {
  const match = url ? /\/documents\/([0-9a-f-]{36})\/file$/i.exec(url) : null;
  return match ? match[1] : null;
}

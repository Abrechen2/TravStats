/**
 * How a flight's baggage allowance is shown (forgejo#186).
 *
 * The field is free text — it holds what the airline printed: "23 kg",
 * "2x23kg", "1 PC", "50 lbs". A user who types only "23" got "Freigepäck 23"
 * on the flight page, a number with no unit. The rule lives here and nowhere
 * else: a BARE number is shown with the user's weight unit, and anything that
 * already says more is shown exactly as stored.
 *
 * Deliberately NOT a conversion. The preference names the unit of a bare
 * number; it never turns 23 kg into 51 lb, because the stored text is the
 * airline's statement, not a measurement of ours. And the stored string is
 * never rewritten — the unit is added on display only.
 */

export const WEIGHT_UNITS = ["kg", "lb"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Baggage allowances are quoted in kilograms unless the user says otherwise. */
export const DEFAULT_WEIGHT_UNIT: WeightUnit = "kg";

/** Digits with at most one decimal part, comma or point: "23", "23,5", "23.5". */
const BARE_NUMBER = /^\d+(?:[.,]\d+)?$/;

/**
 * A setting read from an older browser's persisted state, or from a server
 * row saved before the preference existed, has no weight unit at all — and an
 * unknown string must not end up printed behind a number.
 */
export function resolveWeightUnit(unit: string | null | undefined): WeightUnit {
  return (WEIGHT_UNITS as readonly string[]).includes(unit ?? "")
    ? (unit as WeightUnit)
    : DEFAULT_WEIGHT_UNIT;
}

/** True when the text is nothing but a number, so a unit would complete it. */
export function isBareBaggageNumber(stored: string | null | undefined): boolean {
  return typeof stored === "string" && BARE_NUMBER.test(stored.trim());
}

/**
 * The allowance as shown to the user, or `null` when there is none — an empty
 * field stays absent rather than becoming a lone "kg".
 */
export function formatBaggageAllowance(
  stored: string | null | undefined,
  unit: string | null | undefined
): string | null {
  if (typeof stored !== "string") return null;
  const trimmed = stored.trim();
  if (trimmed === "") return null;
  if (BARE_NUMBER.test(trimmed)) return `${trimmed} ${resolveWeightUnit(unit)}`;
  return stored;
}

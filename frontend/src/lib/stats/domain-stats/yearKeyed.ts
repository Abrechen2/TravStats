// Shared conversion for the backend's year-keyed maps.
//
// JSON has no numeric object keys, so every year-keyed index arrives as
// Record<string, T> while the domain-stats contract (and the year selector
// that drives it) works in numbers. Doing the conversion in one place keeps
// the two adapters from drifting apart on how a malformed key is handled.

/**
 * Normalise a year-keyed record from the API into numeric keys.
 *
 * Returns `undefined` when the backend did not send the field at all — the
 * caller must be able to tell "no index available" (fall back to the
 * lifetime set) apart from "index is empty" (genuinely no countries).
 * Non-numeric keys are dropped rather than coerced to NaN.
 */
export function toYearKeyed<T>(
  input: Record<string, T> | undefined
): Record<number, T> | undefined {
  if (input === undefined) return undefined;
  const out: Record<number, T> = {};
  for (const [key, value] of Object.entries(input)) {
    const year = Number.parseInt(key, 10);
    if (!Number.isFinite(year)) continue;
    out[year] = value;
  }
  return out;
}

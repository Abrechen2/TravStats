import { useEffect, useRef } from "react";

/**
 * Fills an EMPTY field with a suggestion, and keeps a value it wrote in step
 * with the suggestion — but never touches a value the user typed.
 *
 * The distinction is kept by remembering what this hook wrote last: a field
 * still holding exactly that is ours to replace (the airline changed from
 * Lufthansa to SWISS, so the Miles & More number it filled is now wrong) or to
 * clear (the new airline has no history, and a stale number is worse than
 * none). Anything else in the field is the user's, and stays.
 *
 * Returns whether the current value is the suggestion this hook filled in, so
 * the field can say where it came from.
 */
export function useSuggestedPrefill(
  suggestion: string | null,
  value: string,
  onChange: (value: string) => void
): boolean {
  const written = useRef<string | null>(null);

  useEffect(() => {
    const ours = written.current !== null && value === written.current;
    if (value && !ours) {
      written.current = null;
      return;
    }
    const next = suggestion ?? "";
    if (next === value) return;
    written.current = next || null;
    onChange(next);
    // `value` is read, not watched: a keystroke must not re-run the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion]);

  return Boolean(value) && value === written.current;
}

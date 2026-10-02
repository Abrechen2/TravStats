/**
 * A number as a person types it into a text field, in either notation:
 * "150,00" and "150.00" are both 150, "1.500,00" and "1,500.00" both 1500.
 *
 * `Number()` knows only the dot, so a form that validated with it refused the
 * ordinary German "150,00" as "not a number" (forgejo#163). Where BOTH marks
 * appear, the last one is the decimal mark and the other is grouping. A
 * lone mark is the decimal mark — "1.500" stays 1.5, as `Number()` read it,
 * because nothing in the string says which convention the typist meant.
 *
 * Returns null for an empty field and NaN for text that is not a number, so
 * a caller can tell "left blank" from "typed wrong".
 */
export function parseDecimalInput(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  const [group, decimal] = lastComma > lastDot ? [".", ","] : [",", "."];
  const ungrouped = lastComma >= 0 && lastDot >= 0 ? value.split(group).join("") : value;
  // More than one decimal mark ("1,2,3") is not a number in any notation.
  if (ungrouped.split(decimal).length > 2) return Number.NaN;
  const normalised = ungrouped.replace(decimal, ".");
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalised) ? Number(normalised) : Number.NaN;
}

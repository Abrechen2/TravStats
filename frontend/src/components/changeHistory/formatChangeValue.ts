/**
 * One recorded value as text. The ledger keeps JSON (`services/changeLedger/
 * values.ts`): a date as its ISO string, a decimal as a string, a list as an
 * array. A legacy time column holds the place's wall clock stored as if UTC,
 * so the caller shows `DateTime` values in UTC; a real instant (`…Utc`) says so.
 */
export interface ChangeValueWords {
  dateTime: (iso: string) => string;
  empty: string;
  yes: string;
  no: string;
  /** The word for a coded value ("business" → "Geschäftlich"), or null to show it as stored. */
  label?: (value: string) => string | null;
}

export function formatChangeValue(
  value: unknown,
  valueType: string | null,
  field: string | null,
  words: ChangeValueWords
): string {
  if (value === null || value === undefined || value === "") return words.empty;
  if (Array.isArray(value)) {
    return value.length === 0 ? words.empty : value.map((v) => String(v)).join(", ");
  }
  if (typeof value === "boolean") return value ? words.yes : words.no;
  if (valueType === "DateTime" && typeof value === "string") {
    const shown = words.dateTime(value);
    return field?.endsWith("Utc") ? `${shown} UTC` : shown;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return (typeof value === "string" ? words.label?.(value) : null) ?? String(value);
}

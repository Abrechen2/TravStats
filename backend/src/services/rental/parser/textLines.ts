/**
 * Line and value helpers shared by the rental templates. Mail bodies arrive
 * with link targets inline (`<https://…>`), tabs between label and value and
 * zero-width non-joiners wrapped around numbers (measured on the Sixt
 * corpus); each is removed here once, so a template matches printed text only.
 */

const ZERO_WIDTH = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join("")}]`,
  "g"
);
const LINK = /<(?:https?|mailto):[^>]*>/gi;

/** The document's lines: links, zero-width marks and repeated blanks removed. */
export function cleanLines(text: string): string[] {
  return text
    .replace(ZERO_WIDTH, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(LINK, " ")
        .replace(/[\t ]+/g, " ")
        .replace(/^\|\s*/, "")
        .trim()
    )
    .filter((line) => line.length > 0);
}

/** German, English, French and Dutch month names and abbreviations → month number. */
const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, janvier: 1, januari: 1,
  feb: 2, februar: 2, february: 2, fevrier: 2, février: 2, februari: 2,
  mar: 3, mär: 3, mrz: 3, märz: 3, march: 3, mars: 3, maart: 3,
  apr: 4, april: 4, avril: 4,
  mai: 5, may: 5, mei: 5,
  jun: 6, juni: 6, june: 6, juin: 6,
  jul: 7, juli: 7, july: 7, juillet: 7,
  aug: 8, august: 8, aout: 8, août: 8, augustus: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dez: 12, dec: 12, dezember: 12, december: 12, decembre: 12, décembre: 12,
}; // prettier-ignore

export function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? null;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:mm` from its parts; null when the parts name no real day. */
export function wallClock(
  year: number,
  month: number,
  day: number,
  hour: number | null,
  minute: number | null
): string | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (hour === null || minute === null) return date;
  if (hour > 23 || minute > 59) return null;
  return `${date}T${pad(hour)}:${pad(minute)}`;
}

/** "1.234,56" / "1,234.56" / "123,45" → a number; null when it is not one. */
export function parseAmount(raw: string): number | null {
  const compact = raw.replace(/\s/g, "");
  const european = /^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(compact);
  const normalised = european
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact.replace(/,/g, "");
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** "€" / "EUR" / "$" → ISO 4217; null for a symbol that names no single currency. */
export function currencyOf(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (s === "€" || s === "EUR") return "EUR";
  if (s === "£" || s === "GBP") return "GBP";
  if (s === "CHF") return "CHF";
  if (/^[A-Z]{3}$/.test(s)) return s;
  return null;
}

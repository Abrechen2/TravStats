import type { Currency } from "../../lib/units";
import { formatCurrency } from "../../lib/units";
import { formatDate } from "../../lib/displayFormat";
import type { EvidenceEntry, EvidenceMeasure } from "../../shared/evidence";

/**
 * Turning the contract's `{key, values} | {text}` shape into on-screen text —
 * client-side, per the design ("Titles and labels are i18n KEYS, not server
 * strings"). A hotel's own name (`{text}`) is never run through the
 * translator; a computed label (`{key, values}`) always is.
 */
type I18nOrText = EvidenceMeasure["label"] | EvidenceEntry["subtitle"];
type Translator = (key: string, options?: Record<string, unknown>) => string;

/**
 * `AirportCreditRole` (`rankingEvidence.ts`) arrives as the literal English
 * words `"departure" | "arrival" | "both"` inside `evidence.ranking.airport.subtitle`'s
 * `values.role` — a computed classification, not the traveller's own data, so
 * it gets its own translation rather than being interpolated raw into a
 * German sentence.
 */
const AIRPORT_SUBTITLE_KEY = "evidence.ranking.airport.subtitle";
const ROLE_KEYS: Record<string, string> = {
  departure: "evidence.entry.role.departure",
  arrival: "evidence.entry.role.arrival",
  both: "evidence.entry.role.both",
};

/**
 * Every backend label/title/subtitle key is a literal dotted string
 * (`evidence.ranking.airport`, `evidence.ranking.airport.subtitle`) rather
 * than a nested path — `evidence.ranking.airport` is itself a STRING while
 * `evidence.ranking.airport.subtitle` is a SIBLING key sharing its prefix, so
 * the two cannot live as a nested JSON tree (a leaf cannot also hold a
 * child). `keySeparator: false` treats the whole string as one flat key,
 * matching the flat entries `i18n/resources/<locale>/evidence.json` declares.
 */
export function composeI18nText(value: I18nOrText, t: Translator): string {
  if (value === null) return "";
  if ("text" in value) return value.text;

  let values = value.values;
  if (value.key === AIRPORT_SUBTITLE_KEY && typeof values?.role === "string") {
    const roleKey = ROLE_KEYS[values.role];
    if (roleKey) {
      values = { ...values, role: t(roleKey, { ns: "evidence", keySeparator: false }) };
    }
  }
  return t(value.key, { ...values, ns: "evidence", keySeparator: false });
}

/** `null` — an undated entry — is rendered by the caller, not here. */
export function formatEvidenceDate(date: EvidenceEntry["date"], language: string): string | null {
  if (!date) return null;
  switch (date.precision) {
    case "day":
      // The user's own date-format preference, same as everywhere else on the
      // frontend (`lib/displayFormat.ts`), rather than a fixed locale.
      return formatDate(date.value);
    case "month":
      return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
        year: "numeric",
        month: "long",
      }).format(new Date(date.value));
    case "year":
      return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
        year: "numeric",
      }).format(new Date(date.value));
  }
}

/**
 * The measure's value, formatted for the header. `null` is handled by the
 * caller — the abstention sentence, never "0" (design, "`measure.value` may
 * be `null`").
 */
export function formatMeasureValue(
  measure: EvidenceMeasure,
  t: Translator,
  language: string,
  baseCurrency: string
): string | null {
  if (measure.value === null) return null;
  const locale = language === "de" ? "de-DE" : "en-GB";
  if (measure.unit === "currency") {
    return formatCurrency(measure.value, baseCurrency as Currency, { language });
  }
  const number = new Intl.NumberFormat(locale).format(measure.value);
  const unitKey = `evidence:unit.${measure.unit}`;
  const unitLabel = t(unitKey);
  return unitLabel && unitLabel !== unitKey ? `${number} ${unitLabel}` : number;
}

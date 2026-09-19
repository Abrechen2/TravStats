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
 *
 * These three are the PANEL's own copy, so they are addressed the way every
 * other panel string is — namespace prefix plus a NESTED key
 * (`evidence:entry.credits`, `EvidenceEntryRow.tsx`) — and not the way a
 * backend label key is. The flat `evidence.entry.role.arrival` form they
 * carried until 2026-09-19 resolved against nothing: the resources hold
 * `entry.role.arrival` under the `entry` branch, while the lookup below asked
 * for a literal flat key with `keySeparator: false`. react-i18next answers a
 * miss with the key itself, so the airport ranking rows shipped
 * "BCN → MUC · evidence.entry.role.arrival" as copy. `EVIDENCE_TEXT_KEYS`
 * below exists so a guard can resolve all three without re-stating them.
 */
const AIRPORT_SUBTITLE_KEY = "evidence.ranking.airport.subtitle";
const ROLE_KEYS: Record<string, string> = {
  departure: "evidence:entry.role.departure",
  arrival: "evidence:entry.role.arrival",
  both: "evidence:entry.role.both",
};

/**
 * Every i18n key this module names LITERALLY — the guard's input, not an API.
 * The one key it builds at runtime (`evidence:unit.<unit>`) is not here
 * because it cannot be: the unit comes off the measure. `formatMeasureValue`
 * carries its own miss check for it instead, and falls back to the bare
 * number rather than printing the key.
 */
export const EVIDENCE_TEXT_KEYS: readonly string[] = Object.values(ROLE_KEYS);

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
      // No `keySeparator: false` here, unlike the backend key below: this one
      // IS a nested path under `entry`, and disabling the separator is what
      // made it resolve to itself.
      values = { ...values, role: t(roleKey) };
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

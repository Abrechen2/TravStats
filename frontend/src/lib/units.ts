import i18next from "i18next";
import { minorUnits } from "../shared/currencies";
export type DistanceUnit = "kilometers" | "miles" | "nautical_miles";

/**
 * ISO 4217 alpha-3 currency code. Any 3-letter code accepted by
 * `Intl.NumberFormat` is valid (EUR, USD, GBP, CHF, INR, JPY, …).
 * Backend validates the same shape via Zod regex.
 */
export type Currency = string;

/**
 * Convert distance from kilometers to the specified unit
 */
export function convertDistance(km: number, unit: DistanceUnit): number {
  switch (unit) {
    case "kilometers":
      return km;
    case "miles":
      return km * 0.621371;
    case "nautical_miles":
      return km * 0.539957;
    default:
      return km;
  }
}

/**
 * Map a UI language code to the BCP-47 locale used for number formatting.
 * Keeps the active i18n language as the source of truth so a user who
 * switched to English sees thousands separators with commas, not dots.
 */
function localeForLanguage(language: string | undefined): string {
  if (!language) return "en-US";
  const lower = language.toLowerCase();
  if (lower.startsWith("de")) return "de-DE";
  if (lower.startsWith("en")) return "en-US";
  return language;
}

/**
 * The language i18next is currently serving, for the call sites that cannot
 * thread it through (#264). Read lazily from the singleton rather than the
 * app's own i18n config, which would make this module import the whole
 * resource bundle — and would be a cycle, since the config imports stores
 * that import this file. Before init, `language` is undefined and
 * `localeForLanguage` answers with one stable default; that is the point —
 * a fixed answer instead of the host's.
 */
function activeLanguage(): string | undefined {
  return i18next.language;
}

/**
 * Format distance with unit label. Pass the active i18n language so the
 * thousands separator follows the user's selection rather than the
 * browser/OS locale (which is what `toLocaleString(undefined, …)` does).
 */
export function formatDistance(
  km: number,
  unit: DistanceUnit,
  t: (key: string) => string,
  language?: string
): string {
  const converted = convertDistance(km, unit);
  const label = getDistanceLabel(unit, t);
  const locale = localeForLanguage(language);
  return `${converted.toLocaleString(locale, { maximumFractionDigits: 0 })} ${label}`;
}

/**
 * Get distance unit label from translation
 */
export function getDistanceLabel(unit: DistanceUnit, t: (key: string) => string): string {
  switch (unit) {
    case "kilometers":
      return t("stats:distance.kilometers");
    case "miles":
      return t("stats:distance.miles");
    case "nautical_miles":
      return t("stats:distance.nautical_miles");
    default:
      return t("stats:distance.kilometers");
  }
}

/**
 * Curated list of ISO 4217 codes shown in the currency picker dropdown.
 * Covers the most commonly used currencies in international travel —
 * users on a different code can still POST it directly to the API
 * (Backend Zod accepts any /^[A-Z]{3}$/). Add codes here as picker
 * coverage requests come in.
 */
export const CURRENCY_OPTIONS: ReadonlyArray<string> = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "AUD",
  "CAD",
  "NZD",
  "JPY",
  "CNY",
  "KRW",
  "INR",
  "SGD",
  "HKD",
  "THB",
  "MYR",
  "IDR",
  "AED",
  "SAR",
  "ILS",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "BRL",
  "MXN",
  "ARS",
  "ZAR",
  "TRY",
  "RUB",
] as const;

/**
 * Localized display name for an ISO 4217 code (e.g. "Euro", "US-Dollar",
 * "Indische Rupie"). Falls back to the raw code if Intl.DisplayNames is
 * unavailable or rejects the input.
 */
export function getCurrencyDisplayName(code: string, locale?: string): string {
  try {
    const dn = new Intl.DisplayNames([locale || navigator.language || "en"], {
      type: "currency",
    });
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

// Locale hints for the few currencies whose default Intl formatting differs
// from what European users expect (e.g. en-IN groups INR as "8,49,999" with
// the lakh separator). For everything else, the user's browser locale is
// fine — Intl.NumberFormat resolves the symbol and rules from `currency`.
const LOCALE_HINTS: Record<string, string> = {
  EUR: "de-DE",
  USD: "en-US",
  GBP: "en-GB",
  CHF: "de-CH",
  INR: "en-IN",
  JPY: "ja-JP",
  CNY: "zh-CN",
};

/**
 * Format a currency value as a localized string. Accepts any ISO 4217
 * alpha-3 code natively supported by Intl.NumberFormat.
 *
 * The digit count comes from the registry, not from a fixed 2: JPY has none
 * and KWD has three, so a fixed cap silently dropped a dinar's third decimal.
 *
 * `compact` rounds to whole units for headline figures (the trip cards). It
 * exists so those cards can stop carrying their OWN copy of this function,
 * which is how a trip total and a stay total came to disagree about how a
 * currency is written.
 */
export function formatCurrency(
  value: number,
  currency: Currency,
  opts?: { compact?: boolean; language?: string }
): string {
  if (value === undefined || value === null || isNaN(value)) return "";

  // The UI language decides, never the host (#264). Passing `undefined` to
  // Intl resolves to the RUNTIME locale, so an English-locale browser wrote
  // "AED 11,662" while the exchange rate one line below — which does honour
  // the language — wrote "4,0100". Two number formats in one card.
  //
  // `LOCALE_HINTS` stays, but only as a refinement WITHIN the chosen
  // language: it is consulted when the currency's own country formats it
  // distinctively and the UI language does not contradict that. It covered
  // seven currencies; 2.6.0 accepts all 155, so it can never be the primary
  // source. Falling back to i18next's active language keeps the 35 existing
  // call sites correct without each having to thread the language through.
  const language = opts?.language ?? activeLanguage();
  const locale = localeForLanguage(language);
  const digits = opts?.compact ? 0 : minorUnits(currency);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    // Intl rejects unknown / malformed codes — render the raw value with
    // the currency code as suffix so the data is still readable.
    return `${value.toLocaleString()} ${currency}`;
  }
}

/**
 * Get the locale-resolved currency symbol (€, $, ₹, ¥, …) without a
 * formatted number. Falls back to the ISO code if the runtime can't
 * resolve a symbol.
 */
export function getCurrencySymbol(currency: Currency): string {
  const locale = LOCALE_HINTS[currency] || undefined;
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

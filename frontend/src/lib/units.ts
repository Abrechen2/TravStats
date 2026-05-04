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
 * Format distance with unit label
 */
export function formatDistance(km: number, unit: DistanceUnit, t: (key: string) => string): string {
  const converted = convertDistance(km, unit);
  const label = getDistanceLabel(unit, t);
  return `${converted.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${label}`;
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
  "EUR", "USD", "GBP", "CHF", "AUD", "CAD", "NZD",
  "JPY", "CNY", "KRW", "INR", "SGD", "HKD", "THB", "MYR", "IDR",
  "AED", "SAR", "ILS",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "BRL", "MXN", "ARS", "ZAR", "TRY", "RUB",
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
 * Format currency value as a localized string. Accepts any ISO 4217
 * alpha-3 code natively supported by Intl.NumberFormat.
 */
export function formatCurrency(value: number, currency: Currency): string {
  if (value === undefined || value === null || isNaN(value)) return "";

  const locale = LOCALE_HINTS[currency] || undefined;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
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

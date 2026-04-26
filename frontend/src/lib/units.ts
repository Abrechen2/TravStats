export type DistanceUnit = "kilometers" | "miles" | "nautical_miles";
export type Currency = "EUR" | "USD" | "GBP" | "CHF";

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
 * Format currency value based on currency code
 */
export function formatCurrency(value: number, currency: Currency): string {
  if (value === undefined || value === null || isNaN(value)) return "";

  try {
    // Map currency codes to locale strings for proper formatting
    const localeMap: Record<Currency, string> = {
      EUR: "de-DE",
      USD: "en-US",
      GBP: "en-GB",
      CHF: "de-CH",
    };

    const locale = localeMap[currency] || "de-DE";

    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Fallback if Intl.NumberFormat fails
    const symbolMap: Record<Currency, string> = {
      EUR: "€",
      USD: "$",
      GBP: "£",
      CHF: "CHF ",
    };
    return `${symbolMap[currency] || ""}${value.toLocaleString()}`;
  }
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: Currency): string {
  const symbolMap: Record<Currency, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
    CHF: "CHF ",
  };
  return symbolMap[currency] || "€";
}

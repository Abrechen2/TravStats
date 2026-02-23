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

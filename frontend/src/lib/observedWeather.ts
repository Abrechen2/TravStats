import type { ObservedWeather } from "../types";

/** The WMO code groups the journal names, from the Open-Meteo documentation. */
export type WeatherKind =
  "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "showers" | "thunder";

export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "thunder";
  return "cloudy";
}

/**
 * "17°/11° · Nieselregen · 0,7 mm" — high and low of the day, what it was, and
 * the rain when there was any. Written by the reader's locale.
 */
export function formatObservedWeather(
  w: ObservedWeather,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string | undefined
): string {
  const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const parts = [
    `${nf0.format(w.tMaxC)}°/${nf0.format(w.tMinC)}°`,
    t(`openData:weather.code.${weatherKind(w.code)}`),
    w.precipMm >= 0.1 ? `${nf1.format(w.precipMm)} mm` : null,
  ];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

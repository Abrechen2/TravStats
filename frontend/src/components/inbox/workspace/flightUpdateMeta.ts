import type { Translate } from "./model";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Wire names whose translation key is spelled differently from the value. */
const SOURCE_KEYS: Record<string, string> = {
  historical_aggregation: "historicalAggregation",
  // A paired phone's own observation (forgejo#194). The raw value is the
  // evidence kind; printed as "device_gps" it tells the reader nothing.
  device_gps: "deviceGps",
};

/** Providers that are a product name, not a word to translate. */
const SOURCE_NAMES: Record<string, string> = {
  aeroapi: "FlightAware AeroAPI",
};

/**
 * Who proposed the change, in words: the evidence the user weighs before
 * applying it. An unknown source keeps its raw value rather than inventing one.
 */
export function apiSourceLabel(source: string, t: Translate): string {
  if (SOURCE_NAMES[source]) return SOURCE_NAMES[source];
  return t(`pendingUpdates:apiSource.${SOURCE_KEYS[source] ?? source}`, { defaultValue: source });
}

/** How long the proposal still waits before the nightly sweep expires it. */
export function expiresInLabel(expiresAt: string, now: number, t: Translate): string | null {
  const left = Date.parse(expiresAt) - now;
  if (Number.isNaN(left) || left <= 0) return null;
  if (left < HOUR_MS) return `${Math.floor(left / 60_000)} ${t("pendingUpdates:minutes")}`;
  if (left < DAY_MS) return `${Math.floor(left / HOUR_MS)} ${t("pendingUpdates:hours")}`;
  return `${Math.floor(left / DAY_MS)} ${t("pendingUpdates:days")}`;
}

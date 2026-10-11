import type { BusDistanceSource, BusGeometryReport, BusRouteFallback } from "../../types/bus";

/**
 * The words of bus road routing (spec 2026-10-07-bus-domain-design §5, B3).
 *
 * "Luftlinie" is a statement about ONE ride's distance: it is said only for a
 * ride whose `distanceSource` is `great_circle`. A routed length is "Straße",
 * a figure read off the ticket "laut Ticket". Every provider failure has its
 * own sentence in both languages — a raw server string never reaches the user.
 */

const SOURCE_KEY: Record<BusDistanceSource, string> = {
  great_circle: "bus:distanceSource.great_circle",
  route: "bus:distanceSource.route",
  user: "bus:distanceSource.user",
};

/** The i18n key naming what a ride's distance measures; null when it has none. */
export function distanceSourceKey(source: BusDistanceSource | null): string | null {
  return source === null ? null : SOURCE_KEY[source];
}

const FALLBACKS: readonly BusRouteFallback[] = [
  "no_provider",
  "unroutable_mode",
  "provider_error",
  "no_route",
  "point_not_near_road",
  "rate_limited",
  "auth",
  "untrustworthy",
];

/** The sentence for a fallback reason; an unknown code (a newer server) reads as a provider error. */
export function fallbackReasonKey(reason: string | null): string {
  const known = FALLBACKS.find((r) => r === reason);
  return `bus:routing.reason.${known ?? "provider_error"}`;
}

/**
 * The toast a save owes the user, or null when nothing went wrong. A missing
 * provider is not repeated here: the form said so once, plainly, before the
 * save, and a toast on every ride would only train people to ignore it.
 */
export function saveGeometryNotice(
  report: BusGeometryReport | null
): { key: string; reasonKey: string } | null {
  if (!report || report.fallback === null || report.fallback === "no_provider") return null;
  if (report.outcome === "straight") {
    return { key: "bus:routing.savedStraight", reasonKey: fallbackReasonKey(report.fallback) };
  }
  if (report.outcome === "kept") {
    return { key: "bus:routing.savedKept", reasonKey: fallbackReasonKey(report.fallback) };
  }
  return null;
}

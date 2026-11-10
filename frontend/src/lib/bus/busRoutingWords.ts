import type {
  BusDistanceSource,
  BusGeometrySource,
  BusGeometryReport,
  BusLineMiss,
  BusRouteFallback,
} from "../../types/bus";

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

/** A routed length read off the timetable's own line is the timetable's, not the road's. */
const TIMETABLE_KEY = "bus:distanceSource.timetable";

/**
 * The i18n key naming what a ride's distance measures; null when it has none.
 * A routed distance whose geometry came from the timetable (`transitous`) is
 * "Fahrplan", not "Straße": the length is the line's, not a road route's.
 */
export function distanceSourceKey(
  source: BusDistanceSource | null,
  geometrySource?: BusGeometrySource | null
): string | null {
  if (source === null) return null;
  if (source === "route" && geometrySource === "transitous") return TIMETABLE_KEY;
  return SOURCE_KEY[source];
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

const LINE_MISSES: readonly BusLineMiss[] = [
  "no_match",
  "no_shape",
  "rate_limited",
  "timeout",
  "unavailable",
];

/**
 * The sentence for why the timetable line was not used; null when it was, or
 * none was asked for. An unknown code (a newer server) reads as unavailable.
 */
export function lineMissKey(miss: string | null | undefined): string | null {
  if (!miss || miss === "no_line") return null;
  const known = LINE_MISSES.find((m) => m === miss);
  return `bus:routing.lineMiss.${known ?? "unavailable"}`;
}

/**
 * The toast a save owes the user, or null when nothing went wrong. A missing
 * provider is not repeated here: the form said so once, plainly, before the
 * save, and a toast on every ride would only train people to ignore it.
 */
export function saveGeometryNotice(
  report: BusGeometryReport | null
): { key: string; reasonKey: string } | null {
  const miss = lineMissKey(report?.lineMiss);
  if (report && miss && report.outcome === "routed") {
    return { key: "bus:routing.savedRoadForLine", reasonKey: miss };
  }
  if (report && miss && report.outcome === "straight" && report.fallback === "no_provider") {
    return { key: "bus:routing.savedStraightNoLine", reasonKey: miss };
  }
  if (report && miss && report.outcome === "kept") {
    return { key: "bus:routing.savedKeptLine", reasonKey: miss };
  }
  if (!report || report.fallback === null || report.fallback === "no_provider") return null;
  if (report.outcome === "straight") {
    return { key: "bus:routing.savedStraight", reasonKey: fallbackReasonKey(report.fallback) };
  }
  if (report.outcome === "kept") {
    return { key: "bus:routing.savedKept", reasonKey: fallbackReasonKey(report.fallback) };
  }
  return null;
}

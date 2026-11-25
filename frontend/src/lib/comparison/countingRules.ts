/**
 * "Wie gezählt?": which counting rule stands behind each leaderboard metric. The rule's one home
 * is a `shared/*` module (CLAUDE.md: "a counting rule has exactly one home"); the text lives in
 * `comparison:counting.<rule>`. `countingRules.test.ts` fails for a metric with no entry.
 */
import { LEADERBOARD_METRICS } from "../../shared/comparisonMetrics";

export type CountingRule =
  | "flight"
  | "flightTime"
  | "cruise"
  | "rail"
  | "bus"
  | "rental"
  | "ferry"
  | "tour"
  | "lodging"
  | "place"
  | "daysAway"
  | "countries"
  | "curated";

/** The shared module that owns the rule, for the "where is this decided" line. */
export const RULE_HOME: Record<CountingRule, string> = {
  flight: "shared/flightCounting.ts",
  flightTime: "shared/flightDuration.ts",
  cruise: "shared/cruiseCounting.ts",
  rail: "shared/railCounting.ts",
  bus: "shared/busCounting.ts",
  rental: "shared/rentalCounting.ts",
  ferry: "shared/ferryCounting.ts",
  tour: "shared/tour/tourCounting.ts",
  lodging: "shared/lodgingCounting.ts",
  place: "shared/placeCounting.ts",
  daysAway: "shared/crossDomainCounting.ts",
  countries: "shared/crossDomainCounting.ts",
  curated: "shared/placeCounting.ts",
};

const EXPLICIT: Record<string, CountingRule> = {
  flightMinutes: "flightTime",
  daysAway: "daysAway",
  countries: "countries",
  cruisePorts: "cruise",
  stays: "lodging",
  nights: "lodging",
  places: "place",
  placeVisits: "place",
  rentalDays: "rental",
  rentals: "rental",
};
const BY_DOMAIN: Record<string, CountingRule> = {
  flight: "flight",
  cruise: "cruise",
  rail: "rail",
  bus: "bus",
  rental: "rental",
  ferry: "ferry",
  tour: "tour",
  lodging: "lodging",
  poi: "place",
};

export function countingRuleOf(metricKey: string): CountingRule | null {
  const m = LEADERBOARD_METRICS.find((x) => x.key === metricKey);
  if (!m) return null;
  if ("curatedList" in m && m.curatedList) return "curated";
  if (EXPLICIT[m.key]) return EXPLICIT[m.key];
  return m.domain ? (BY_DOMAIN[m.domain] ?? null) : null;
}

import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import {
  LEADERBOARD_SCHEMA,
  leaderboardSnapshotSchema,
  type LeaderboardScope,
  type LeaderboardSnapshot,
} from "../../schemas/comparison";
import { loadVisibleDomains } from "../domainVisibility";
import { loadPassport } from "../stats/passportLoader";
import { loadDaysAway } from "../stats/daysAwayLoader";
import { DOMAIN_AGGREGATES } from "./domainAggregates";
import { comparisonError } from "./errors";

/**
 * One person's totals under one consent scope (spec §8).
 *
 * A metric whose group or domain the consent leaves out is ABSENT; one in scope that cannot be
 * derived is null. Cross-domain figures (days away, countries) are only derivable when the
 * consent covers every domain the owner has visible: their loaders have no domain mask, and a
 * whole-account figure would leak the domains the owner kept back — the rule snapshots.ts
 * already applied. `countries` has no per-year loader and is null for a year.
 */
export async function buildLeaderboardSnapshot(
  userId: string,
  scope: LeaderboardScope,
  year: number | null
): Promise<LeaderboardSnapshot> {
  if (scope.year !== null && scope.year !== year)
    throw comparisonError("COMPARISON_YEAR_NOT_SHARED", 403, "Shared for another year only", {
      userId,
      year,
      sharedYear: scope.year,
    });
  const visible = await loadVisibleDomains(userId);
  const domains = visible.filter((d) => scope.domains.includes(d));
  const wholeAccount = domains.length === visible.length;
  const allowed = LEADERBOARD_METRICS.filter(
    (m) => scope.groups.includes(m.group) && (m.domain === null || domains.includes(m.domain))
  );
  const allowedKeys = new Set<string>(allowed.map((m) => m.key));
  const values: Partial<Record<MetricKey, number | null>> = {};
  const partial: MetricKey[] = [];
  // Independent loaders, one per shared domain: read them side by side, merge in domain order.
  const loaded = await Promise.all(
    domains
      .filter((domain) => allowed.some((m) => m.domain === domain))
      .map((domain) => DOMAIN_AGGREGATES[domain](userId, year))
  );
  for (const figures of loaded) {
    for (const [key, value] of Object.entries(figures.values) as Array<[MetricKey, number | null]>)
      if (allowedKeys.has(key)) values[key] = value;
    partial.push(...figures.partial.filter((k) => allowedKeys.has(k)));
  }
  if (allowedKeys.has("daysAway"))
    values.daysAway = wholeAccount
      ? (await loadDaysAway(userId, { year: year ?? undefined })).total
      : null;
  if (allowedKeys.has("countries"))
    values.countries =
      wholeAccount && year === null ? (await loadPassport(userId)).summary.countries : null;
  return leaderboardSnapshotSchema.parse({
    schema: LEADERBOARD_SCHEMA,
    version: 1,
    asOf: new Date().toISOString(),
    year,
    domains,
    metrics: values,
    partial,
  });
}

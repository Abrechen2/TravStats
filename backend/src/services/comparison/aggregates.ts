import type { DomainKey } from "../../shared/domains";
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import {
  LEADERBOARD_SCHEMA,
  leaderboardSnapshotSchema,
  leaderboardSnapshotV2Schema,
  leaderboardSnapshotV3Schema,
  type LeaderboardScope,
  type LeaderboardSnapshot,
} from "../../schemas/comparison";
import { loadVisibleDomains } from "../domainVisibility";
import { withPurposeVisibility } from "../provenance/purposeVisibility";
import { loadPassport } from "../stats/passportLoader";
import { loadDaysAway } from "../stats/daysAwayLoader";
import { DOMAIN_AGGREGATES } from "./domainAggregates";
import { comparisonError } from "./errors";
import { loadCuratedFigures } from "./curatedAggregates";
import { buildYearlyTotals } from "./yearlyTotals";
import { cachedYearlyTotals } from "./yearlyTotalsCache";
import { buildAchievementSection } from "./achievementSection";

/**
 * One person's totals under one consent scope (spec §8).
 *
 * A metric whose group or domain the consent leaves out is ABSENT; one in scope that cannot be
 * derived is null — including every metric of a consented domain the owner has switched off
 * since: they shared it, they just do not track it, and "absent" would tell the reader the
 * opposite. `domains` stays the consented domains the owner actually sees, so a receiver can tell
 * "switched off" (null, domain not listed) from "not derivable" (null, domain listed). Cross-domain figures (days away, countries) are only derivable when the
 * consent covers every domain the owner has visible: their loaders have no domain mask, and a
 * whole-account figure would leak the domains the owner kept back — the rule snapshots.ts
 * already applied. `countries` has no per-year loader and is null for a year.
 *
 * `version` is the snapshot version the reader speaks: 1 is byte-identical to what servers
 * before the achievements section produced; 2 adds the section when the scope carries it.
 */
/** One year's (or the lifetime's) figures under a scope; the loaders' only entry point here. */
async function buildTotals(
  userId: string,
  scope: LeaderboardScope,
  year: number | null
): Promise<{
  domains: DomainKey[];
  values: Partial<Record<MetricKey, number | null>>;
  partial: MetricKey[];
}> {
  const visible = await loadVisibleDomains(userId);
  const domains = visible.filter((d) => scope.domains.includes(d));
  const wholeAccount = domains.length === visible.length;
  const allowed = LEADERBOARD_METRICS.filter(
    (m) => scope.groups.includes(m.group) && (m.domain === null || scope.domains.includes(m.domain))
  );
  const allowedKeys = new Set<string>(allowed.map((m) => m.key));
  // Consented but switched off: no loader runs for it, so its figures stay null.
  const values: Partial<Record<MetricKey, number | null>> = Object.fromEntries(
    allowed
      .filter((m) => m.domain !== null && !domains.includes(m.domain))
      .map((m) => [m.key, null])
  );
  const partial: MetricKey[] = [];
  // Independent loaders, one per shared domain: read them side by side, merge in domain order.
  const loaded = await Promise.all(
    domains
      .filter((domain) => allowed.some((m) => m.domain === domain))
      // What the account hid by purpose is out of the totals it publishes, as on its own screens.
      .map((domain) => withPurposeVisibility(userId, () => DOMAIN_AGGREGATES[domain](userId, year)))
  );
  for (const figures of loaded) {
    for (const [key, value] of Object.entries(figures.values) as Array<[MetricKey, number | null]>)
      if (allowedKeys.has(key)) values[key] = value;
    partial.push(...figures.partial.filter((k) => allowedKeys.has(k)));
  }
  if (allowedKeys.has("daysAway"))
    values.daysAway = wholeAccount
      ? (
          await withPurposeVisibility(userId, () =>
            loadDaysAway(userId, { year: year ?? undefined })
          )
        ).total
      : null;
  if (allowedKeys.has("countries"))
    values.countries =
      wholeAccount && year === null
        ? (await withPurposeVisibility(userId, () => loadPassport(userId))).summary.countries
        : null;
  // Curated-list progress: a place-domain figure like `places`, read only when the consent covers it.
  const curated = await withPurposeVisibility(userId, () =>
    domains.includes("poi") ? loadCuratedFigures(userId, year, allowedKeys) : Promise.resolve({})
  );
  Object.assign(values, curated);
  return { domains, values, partial };
}

export async function buildLeaderboardSnapshot(
  userId: string,
  scope: LeaderboardScope,
  year: number | null,
  version: 1 | 2 | 3 = 1,
  /**
   * Whether the one asking ALSO shares yearly totals back (their own accepted consent toward this
   * owner has `years`). Yearly totals are mutual: without it the figures are not even built, so
   * the rule holds on the server and not only on the page. The owner's own views pass true.
   */
  viewerYears = false
): Promise<LeaderboardSnapshot> {
  if (scope.year !== null && scope.year !== year)
    throw comparisonError("COMPARISON_YEAR_NOT_SHARED", 403, "Shared for another year only", {
      userId,
      year,
      sharedYear: scope.year,
    });
  const { domains, values, partial } = await buildTotals(userId, scope, year);
  const common = {
    schema: LEADERBOARD_SCHEMA,
    asOf: new Date().toISOString(),
    year,
    domains,
    metrics: values,
    partial,
  };
  if (version === 1) return leaderboardSnapshotSchema.parse({ ...common, version: 1 });
  // Lifetime only: a year view never carries the section, whatever the consent says.
  const achievements = year === null ? await buildAchievementSection(userId, scope) : undefined;
  if (version === 2)
    return leaderboardSnapshotV2Schema.parse({
      ...common,
      version: 2,
      ...(achievements ? { achievements } : {}),
    });
  // Yearly totals are an opt-in family: only a lifetime request, only with the consent's switch.
  const years =
    year === null && scope.years === true && viewerYears
      ? await cachedYearlyTotals(
          userId,
          `${[...scope.groups].sort().join(",")}|${[...scope.domains].sort().join(",")}`,
          () =>
            buildYearlyTotals(userId, (y) => buildTotals(userId, scope, y).then((t) => t.values))
        )
      : undefined;
  return leaderboardSnapshotV3Schema.parse({
    ...common,
    version: 3,
    ...(achievements ? { achievements } : {}),
    ...(years ? { years } : {}),
  });
}

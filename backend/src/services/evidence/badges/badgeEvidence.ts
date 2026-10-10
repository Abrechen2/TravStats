import type { EvidenceScope } from "../../../shared/evidence";
import type { EvidenceResponse } from "../../../schemas/evidence";
import { BADGE_PROOF_TYPES, badgeProofKey } from "../../../shared/badgeEvidence";
import { achievementCountries } from "../../../utils/achievementCountries";
import { computeCoreStats, loadCoreInputs } from "../../../utils/achievementInputs";
import type { PagingParams } from "../paging";
import { domainSumEvidence, requireLifetime } from "../domainMeasureResponse";
import { distinctResponse, loadPassportEvidenceIndex, residual } from "../metricEvidencePassport";
import { coreArraysFor } from "./badgeFamiliesCore";
import { loadBadgeFamily } from "./badgeFamiliesDomains";
import { findWitness } from "./witness";

/**
 * The evidence of a badge (forgejo#265): the entries its progress stands on.
 *
 * Every badge opens one of these unless its rule counts exactly what a
 * statistics measure already lists (`BADGE_MEASURE_KEYS`). The figure is the
 * badge's own progress — measured by the badge's own fold — and the rows are
 * its witness (`witness.ts`), each with what it added. Badges are measured
 * over the whole logbook, so the scope is lifetime only.
 */

/** "Belege für diese Auszeichnung" — one label for every badge's proof. */
const LABEL = { key: "evidence.badge.proof" };

async function resolveProof(
  requirementType: string,
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = badgeProofKey(requirementType);
  requireLifetime(scope, key);
  const rule = { requirementType, requirement: 1 };
  const family = await loadBadgeFamily(userId, rule, coreArraysFor(requirementType));
  const witness = family
    ? await findWitness(family.rows, family.progress)
    : { rows: [], contributions: [], progress: 0 };
  const entries = witness.rows.map((row, i) => ({
    ...family!.entryOf(row),
    contribution: witness.contributions[i],
  }));
  const response = domainSumEvidence({
    key,
    unit: "progress",
    scope,
    page,
    entries,
    value: witness.progress,
  });
  return { ...response, measure: { ...response.measure, label: LABEL } };
}

/**
 * The country badges count like the passport (`achievementCountries`), so
 * their evidence is the passport's records — every record that proves one of
 * the BADGE's countries, a place pin excluded as the badge excludes it.
 */
async function resolveCountries(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = badgeProofKey("countries");
  requireLifetime(scope, key);
  const [inputs, index] = await Promise.all([
    loadCoreInputs(userId),
    loadPassportEvidenceIndex(userId),
  ]);
  // The country set is the only measure read here; the trip count is not.
  const { stats } = await computeCoreStats(inputs, {
    countries: (floor) => achievementCountries(userId, floor),
    tripsFullyDocumented: 0,
  });
  const counted = stats.countries;
  const entries = index.records
    .filter((r) => r.entry.domain !== "place")
    .map((r) => ({ ...r.entry, credits: [...r.countries].filter((c) => counted.has(c)).sort() }))
    .filter((e) => e.credits.length > 0);
  const credited = new Set(entries.flatMap((e) => e.credits));
  const response = distinctResponse(
    key,
    "countries",
    counted.size,
    scope,
    page,
    entries,
    residual(counted, credited, () => false)
  );
  return { ...response, measure: { ...response.measure, label: LABEL } };
}

type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

/** Every badge proof, keyed by its evidence key — spread into `METRIC_RESOLVERS`. */
export const BADGE_RESOLVERS: Record<string, Resolver> = Object.fromEntries(
  BADGE_PROOF_TYPES.map((type): [string, Resolver] => [
    badgeProofKey(type),
    type === "countries"
      ? resolveCountries
      : (userId, scope, page) => resolveProof(type, userId, scope, page),
  ])
);

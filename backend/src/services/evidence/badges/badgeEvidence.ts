import type { EvidenceScope } from "../../../shared/evidence";
import type { EvidenceResponse } from "../../../schemas/evidence";
import { BADGE_PROOF_TYPES, badgeProofKey } from "../../../shared/badgeEvidence";
import { badgePassportSources } from "../../../utils/achievementCountries";
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
    ? await findWitness(family.rows, family.progress, { share: family.share })
    : ({ exhausted: false, rows: [], contributions: [], progress: 0 } as const);
  const entries = witness.exhausted
    ? []
    : witness.rows.map((row, i) => ({
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
    // Too many entries to split within the request's budget: no entry is
    // named, and the response says so instead of listing a partial set.
    unattributed: witness.exhausted
      ? [{ count: witness.progress ?? 0, reason: "notPerEntry" }]
      : [],
  });
  return { ...response, measure: { ...response.measure, label: LABEL } };
}

/**
 * The country and continent badges read the passport's ground-contact set
 * (`achievementGeography`, forgejo#299), so their evidence is the passport's
 * records — every record that proves one of the BADGE's countries, read from
 * the badge's own sources (no track, no hidden domain), credited with the
 * country or with that country's continent.
 */
async function resolveGeography(
  type: "countries" | "continents",
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = badgeProofKey(type);
  requireLifetime(scope, key);
  const sources = await badgePassportSources(userId);
  const index = await loadPassportEvidenceIndex(userId, sources);
  // The index carries the badge's passport: the same load, the same rows.
  const ground = index.passport.countries.filter((c) => c.groundPresence);
  const continentOf = new Map(ground.map((c) => [c.code, c.continent as string | null]));
  const creditOf = (code: string): string[] => {
    if (!continentOf.has(code)) return [];
    if (type === "countries") return [code];
    const continent = continentOf.get(code);
    return continent ? [continent] : [];
  };
  const counted = new Set(ground.flatMap((c) => creditOf(c.code)));
  const entries = index.records
    .map((r) => ({ ...r.entry, credits: [...new Set([...r.countries].flatMap(creditOf))].sort() }))
    .filter((e) => e.credits.length > 0);
  const credited = new Set(entries.flatMap((e) => e.credits));
  const response = distinctResponse(
    key,
    type,
    counted.size,
    scope,
    page,
    entries,
    residual(counted, credited)
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
    type === "countries" || type === "continents"
      ? (userId, scope, page) => resolveGeography(type, userId, scope, page)
      : (userId, scope, page) => resolveProof(type, userId, scope, page),
  ])
);

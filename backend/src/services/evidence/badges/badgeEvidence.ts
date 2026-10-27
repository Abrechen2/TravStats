import type { EvidenceScope } from "../../../shared/evidence";
import type { EvidenceResponse } from "../../../schemas/evidence";
import { BADGE_PROOF_TYPES, badgeProofKey } from "../../../shared/badgeEvidence";
import { badgePassportSources } from "../../../utils/achievementCountries";
import type { PagingParams } from "../paging";
import { domainSumEvidence, requireLifetime } from "../domainMeasureResponse";
import type { CountryTimelineEntry } from "../../../schemas/statsCountryDetail";
import type { PassportSources } from "../../stats/passportLoader";
import type { PassportCountry } from "../../stats/passport";
import { continentsOfRecords, groundContinents } from "../../../utils/achievementContinents";
import { isTranscontinental } from "../../../utils/continents";
import {
  distinctResponse,
  loadGroundTimelines,
  loadPassportEvidenceIndex,
  residual,
  type PassportRecord,
} from "../metricEvidencePassport";
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
  const counted =
    type === "countries"
      ? new Set(ground.map((c) => c.code))
      : await groundContinents(userId, ground, sources);
  const creditsOf =
    type === "countries"
      ? async (r: PassportRecord) => [...r.countries].filter((c) => counted.has(c))
      : await continentCredits(userId, sources, ground);
  const creditedRows = await Promise.all(
    index.records.map(async (r) => ({
      ...r.entry,
      credits: [...new Set(await creditsOf(r))].sort(),
    }))
  );
  const entries = creditedRows.filter((e) => e.credits.length > 0);
  const credited = new Set(entries.flatMap((e) => e.credits));
  const response = distinctResponse(
    key,
    type,
    counted.size,
    scope,
    page,
    entries,
    // A flown airport with no catalogue country proves its continent but is no
    // passport record: it is reported as unattributed, not hidden in a row.
    residual(counted, credited)
  );
  return { ...response, measure: { ...response.measure, label: LABEL } };
}

/** Whether a timeline row is part of the passport record it was folded into. */
function rowBelongsTo(row: CountryTimelineEntry, record: PassportRecord): boolean {
  const { domain, id } = record.entry;
  switch (row.kind) {
    case "flight":
      return domain === "flight" && row.flightId === id;
    case "port":
      return domain === "cruise" && row.cruiseId === id;
    case "place":
      return domain === "place" && row.placeId === id;
    case "lodging":
      return domain === "lodging" && row.lodgingId === id;
    case "roadtrip":
      return domain === "roadtrip" && row.roadtripId === id;
    case "rail":
    case "bus":
    case "ferry":
      return domain === row.kind && row.rideId === id;
    default:
      return false;
  }
}

/**
 * Each record's continents, as the badge counts them: a one-continent
 * country's from its row, a transcontinental country's from the record's own
 * coordinates (`continentsOfRecords`), its row only when nothing places it.
 */
async function continentCredits(
  userId: string,
  sources: PassportSources,
  ground: readonly PassportCountry[]
): Promise<(r: PassportRecord) => Promise<string[]>> {
  const continentOf = new Map(ground.map((c) => [c.code, c.continent as string | null]));
  const split = ground.filter((c) => isTranscontinental(c.code)).map((c) => c.code);
  const timelines = await loadGroundTimelines(userId, sources, split);
  const ofRow = (code: string): string[] => {
    const continent = continentOf.get(code);
    return continent ? [continent] : [];
  };
  return async (r) => {
    const credits: string[] = [];
    for (const code of r.countries) {
      const timeline = timelines.get(code);
      if (!timeline) {
        credits.push(...ofRow(code));
        continue;
      }
      const rows = timeline.rows.filter((row) => rowBelongsTo(row, r));
      const airports = timeline.airports.filter((a) => r.airports.has(a));
      const placed = await continentsOfRecords(userId, code, airports, rows);
      credits.push(...(placed.size > 0 ? placed : ofRow(code)));
    }
    return credits;
  };
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

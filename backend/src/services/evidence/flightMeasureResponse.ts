import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import {
  flightDateOf,
  hydrateFlightSumEntries,
  hydrateFlightDistinctEntries,
} from "./entryMappers";

/**
 * The `EvidenceResponse` envelope every flight metric fills in the same way,
 * in one place.
 *
 * Task 7's eighteen resolvers each wrote it out by hand, which was right
 * while there were eighteen of them and each carried a paragraph about its
 * own calculator. Task 7b-1 adds twenty-two more whose bodies are a
 * predicate and nothing else, and twenty-two more hand-written envelopes
 * would be twenty-two chances to hand `omitted.credits` to a `sum` measure
 * or to forget the `evidence.metric.` label prefix — a mistake no test names
 * because every one of them still type-checks. The existing eighteen are
 * left as they are: rewriting them would touch six files for no defect.
 *
 * What stays with each resolver is the only part that is not boilerplate:
 * WHICH rows are in the population, and what each one contributes.
 */

/**
 * Every measure in the fun and unique families is registered
 * `scopes: ["allTime"]`, and their tiles send no year or domain filter at
 * all. Anything else is a 400 — the measure exists, the population asked for
 * does not — rather than a silent all-time answer under a year's heading.
 */
export function requireAllTime(scope: EvidenceScope, label: string): void {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${label} evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
}

export interface FlightRowIdentity {
  id: string;
  departureTime: Date | null;
}

interface FlightSumArgs<T extends FlightRowIdentity> {
  userId: string;
  key: string;
  unit: string;
  scope: EvidenceScope;
  page: PagingParams;
  /** The MATCHED rows — already filtered to the population this measure counts. */
  rows: T[];
  /** Defaults to 1 per row, which is what every counting measure wants. */
  contributionOf?: (row: T) => number;
  /**
   * The surface's own rounding step, applied ONCE to the total.
   * `assertSumInvariant` checks that it happened after the addition and not
   * per row, so passing it here rather than rounding each contribution is
   * the contract, not a preference.
   */
  round?: (total: number) => number;
}

export async function flightSumEvidence<T extends FlightRowIdentity>({
  userId,
  key,
  unit,
  scope,
  page,
  rows,
  contributionOf,
  round = Math.round,
}: FlightSumArgs<T>): Promise<EvidenceResponse> {
  const matched = rows.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    contribution: contributionOf ? contributionOf(row) : 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  const total = matched.reduce((sum, m) => sum + m.contribution, 0);
  return {
    measure: {
      kind: "metric",
      key,
      aggregation: "sum",
      label: { key: `evidence.metric.${key}` },
      unit,
      value: round(total),
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

interface FlightDistinctArgs<T extends FlightRowIdentity> {
  userId: string;
  key: string;
  unit: string;
  scope: EvidenceScope;
  page: PagingParams;
  rows: T[];
  /** The units this row witnesses. An empty list is a row that proves nothing — not an error. */
  creditsOf: (row: T) => string[];
}

export async function flightDistinctEvidence<T extends FlightRowIdentity>({
  userId,
  key,
  unit,
  scope,
  page,
  rows,
  creditsOf,
}: FlightDistinctArgs<T>): Promise<EvidenceResponse> {
  const matched = rows.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    credits: creditsOf(row),
  }));
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
    userId,
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key,
      aggregation: "distinct",
      label: { key: `evidence.metric.${key}` },
      unit,
      // The UNION of credited units, never a row count — one flight can
      // witness two continents and ten flights can witness one timezone.
      value: new Set(matched.flatMap((m) => m.credits)).size,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedRowCount, credits: omittedCredits },
    unattributed: [],
    page,
  };
}

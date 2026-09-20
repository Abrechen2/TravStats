/**
 * The filter bar's options, and the figures above the table.
 *
 * Both used to be the browser's arithmetic over rows it held. The dropdowns
 * came from a SECOND, unfiltered walk of the whole library (`baseline` in
 * LodgingListPage), and the summary strip summed the filtered array. Neither
 * can survive server-side paging: a page of twenty-five rows knows nothing
 * about the other three hundred, and a summary computed from a page is a
 * summary of a page.
 *
 * Two different questions, deliberately answered differently:
 *
 *  - A FACET is counted under every ACTIVE filter EXCEPT its own. A country
 *    list narrowed by the country already chosen holds one entry and cannot be
 *    changed; a year list that ignores the chosen country offers years that
 *    return nothing. Each dimension drops itself and keeps the rest.
 *  - The SUMMARY is counted under all of them, because it describes exactly
 *    what the table is showing.
 *
 * The summary's `stays` and `nights` use the same counting predicate the rows
 * do (`listSql.ts`, restating `shared/lodgingCounting.ts`) — that is the whole
 * point of it living beside the list query rather than in a second module with
 * its own idea of what counts. `lodgingFacets.test.ts` pins the nights figure
 * against the TypeScript rule over the same rows.
 */

import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { LodgingQueryInput } from "../../schemas/lodging";
import { LIFECYCLE_SORT_RANK, LODGING_LIFECYCLE_STATUSES } from "../../shared/lodgingLifecycle";
import { lodgingFilterSql } from "./listQuery";
import { lifecycleRankSql, stayCountsSql, stayNightsSql } from "./listSql";

export interface LodgingFacets {
  chains: Array<{ id: number; name: string; count: number }>;
  /** `value` is what to send back as the `country` filter: the ISO code where
   *  one was derived, the raw text where it was not (a city in the field). */
  countries: Array<{ value: string; isoCode: string | null; count: number }>;
  years: Array<{ year: number; count: number }>;
  types: Array<{ type: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
  summary: LodgingSummary;
}

export interface LodgingSummary {
  lodgings: number;
  /** Stays that COUNT — check-out past, not cancelled. Never every stay row. */
  stays: number;
  nights: number;
  /** Distinct named chains among the matching houses; independents count for none. */
  chains: number;
}

/** The filter keys a facet drops when counting itself. */
type FacetDimension = "chainId" | "country" | "year" | "type" | "status";

function without(query: LodgingQueryInput, dimension: FacetDimension): LodgingQueryInput {
  // A new object, never a delete on the caller's — the query is read five more
  // times after this and each facet must see the others intact.
  const { [dimension]: _dropped, ...rest } = query;
  return rest;
}

/**
 * The matching houses, as a CTE named `agg`, with the columns every facet
 * groups by.
 *
 * The status filter cannot live in the WHERE — it is a verdict over the whole
 * house — so it is applied to the aggregate, the same split `queryLodgingPage`
 * makes. `rank` is carried out of the CTE for the status facet to group on.
 */
function matchingHouses(query: LodgingQueryInput, userId: string): Prisma.Sql {
  const statusFilter =
    query.status === undefined
      ? Prisma.empty
      : Prisma.sql`WHERE status_rank = ${LIFECYCLE_SORT_RANK[query.status]}`;
  return Prisma.sql`
    WITH grouped AS (
      SELECT l.id,
             l.chain_id,
             l.type,
             l.iso_country_code,
             l.country,
             ${lifecycleRankSql()} AS status_rank
      FROM lodgings l
      LEFT JOIN lodging_chains c ON c.id = l.chain_id
      LEFT JOIN lodging_stays s ON s.lodging_id = l.id
      WHERE ${lodgingFilterSql(query, userId)}
      GROUP BY l.id
    ),
    agg AS (SELECT * FROM grouped ${statusFilter})
  `;
}

export async function queryLodgingFacets(params: {
  userId: string;
  query: LodgingQueryInput;
  now?: Date;
}): Promise<LodgingFacets> {
  const { userId, query } = params;
  const now = params.now ?? new Date();

  const [chains, countries, years, types, statuses, summary] = await Promise.all([
    chainFacet(without(query, "chainId"), userId),
    countryFacet(without(query, "country"), userId),
    yearFacet(without(query, "year"), userId),
    typeFacet(without(query, "type"), userId),
    statusFacet(without(query, "status"), userId),
    summarise(query, userId, now),
  ]);

  return { chains, countries, years, types, statuses, summary };
}

async function chainFacet(
  query: LodgingQueryInput,
  userId: string
): Promise<LodgingFacets["chains"]> {
  const rows = await prisma.$queryRaw<Array<{ id: number; name: string; count: bigint }>>(
    Prisma.sql`
      ${matchingHouses(query, userId)}
      SELECT c.id, c.name, COUNT(*) AS count
      FROM agg
      JOIN lodging_chains c ON c.id = agg.chain_id
      GROUP BY c.id, c.name
      ORDER BY c.name ASC
    `
  );
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
}

async function countryFacet(
  query: LodgingQueryInput,
  userId: string
): Promise<LodgingFacets["countries"]> {
  const rows = await prisma.$queryRaw<
    Array<{ value: string; isoCode: string | null; count: bigint }>
  >(Prisma.sql`
    ${matchingHouses(query, userId)}
    -- One option per COUNTRY, not per spelling: "Deutschland" and "Germany"
    -- are one entry because they share a derived ISO code. A text that
    -- resolves to no country at all ("Dubai" is a city) keeps its own entry
    -- rather than vanishing from the filter, and its own text is what the
    -- country parameter then accepts back.
    SELECT COALESCE(iso_country_code, country) AS value,
           iso_country_code AS "isoCode",
           COUNT(*) AS count
    FROM agg
    WHERE COALESCE(iso_country_code, country) IS NOT NULL
    GROUP BY COALESCE(iso_country_code, country), iso_country_code
    ORDER BY value ASC
  `);
  return rows.map((r) => ({ value: r.value, isoCode: r.isoCode, count: Number(r.count) }));
}

async function yearFacet(
  query: LodgingQueryInput,
  userId: string
): Promise<LodgingFacets["years"]> {
  const rows = await prisma.$queryRaw<Array<{ year: number; count: bigint }>>(Prisma.sql`
    ${matchingHouses(query, userId)}
    -- HOUSES per year, matching what the year filter selects. An undated
    -- stay belongs to no year and so offers none; it stays visible while no
    -- year is chosen, which is the behaviour the list has always had.
    SELECT EXTRACT(YEAR FROM s.check_in)::int AS year, COUNT(DISTINCT agg.id) AS count
    FROM agg
    JOIN lodging_stays s ON s.lodging_id = agg.id
    WHERE s.check_in IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  return rows.map((r) => ({ year: r.year, count: Number(r.count) }));
}

async function typeFacet(
  query: LodgingQueryInput,
  userId: string
): Promise<LodgingFacets["types"]> {
  const rows = await prisma.$queryRaw<Array<{ type: string; count: bigint }>>(Prisma.sql`
    ${matchingHouses(query, userId)}
    SELECT type, COUNT(*) AS count FROM agg GROUP BY type ORDER BY type ASC
  `);
  return rows.map((r) => ({ type: r.type, count: Number(r.count) }));
}

async function statusFacet(
  query: LodgingQueryInput,
  userId: string
): Promise<LodgingFacets["statuses"]> {
  const rows = await prisma.$queryRaw<Array<{ rank: number; count: bigint }>>(Prisma.sql`
    ${matchingHouses(query, userId)}
    SELECT status_rank AS rank, COUNT(*) AS count FROM agg GROUP BY status_rank ORDER BY 1 ASC
  `);
  return rows.flatMap((r) => {
    const status = LODGING_LIFECYCLE_STATUSES.find(
      (s) => LIFECYCLE_SORT_RANK[s] === Number(r.rank)
    );
    // Rank 4 is the stayless house, which the list marks "vorgemerkt" in the
    // name column rather than offering as a filterable state — so it has no
    // option to be counted against.
    return status === undefined ? [] : [{ status, count: Number(r.count) }];
  });
}

async function summarise(
  query: LodgingQueryInput,
  userId: string,
  now: Date
): Promise<LodgingSummary> {
  const counts = stayCountsSql(now);
  const [row] = await prisma.$queryRaw<
    Array<{ lodgings: bigint; stays: bigint; nights: number; chains: bigint }>
  >(Prisma.sql`
    ${matchingHouses(query, userId)}
    SELECT COUNT(DISTINCT agg.id) AS lodgings,
           COUNT(*) FILTER (WHERE ${counts}) AS stays,
           COALESCE(SUM(${stayNightsSql()}) FILTER (WHERE ${counts}), 0)::int AS nights,
           COUNT(DISTINCT c.name) AS chains
    FROM agg
    LEFT JOIN lodging_stays s ON s.lodging_id = agg.id
    LEFT JOIN lodging_chains c ON c.id = agg.chain_id
  `);
  return {
    lodgings: Number(row.lodgings),
    stays: Number(row.stays),
    nights: row.nights,
    chains: Number(row.chains),
  };
}

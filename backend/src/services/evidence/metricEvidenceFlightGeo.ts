import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDateOf, hydrateFlightDistinctEntries } from "./entryMappers";
import { countableFlightWhere } from "../../shared/flightCounting";
import { getCachedAirports } from "../airportCache";
import { getContinent } from "../../utils/continents";

/**
 * `airportsVisitedCount`, `flightCountriesVisitedCount`,
 * `continentsVisitedCount` — all `distinct`, all allTime, all fed by
 * `calculateAirportStats` (`utils/stats/airportStats.ts`, `GET
 * /stats/airports`). That function bumps `visits`/`countryCount`/
 * `continentCount` maps per flight without de-duplicating a flight's own two
 * ends against each other; the credit rules below reproduce exactly that —
 * a flight credits an airport/country/continent once per END that resolves
 * to it, and the UNION across flights is what `.size` already was. Paging
 * and hydration are shared via `entryMappers.ts`, not re-derived here.
 */

interface GeoIdentityRow {
  id: string;
  departureTime: Date | null;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
}

async function loadGeoIdentityRows(userId: string): Promise<GeoIdentityRow[]> {
  return prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      departureTime: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
    },
  });
}

function requireAllTime(scope: EvidenceScope, label: string): void {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${label} evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
}

async function loadAirportCodeMap(rows: GeoIdentityRow[]): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const r of rows) {
    if (r.depIata) codes.add(r.depIata);
    if (r.depIcao && !r.depIata) codes.add(r.depIcao);
    if (r.arrIata) codes.add(r.arrIata);
    if (r.arrIcao && !r.arrIata) codes.add(r.arrIcao);
  }
  const airportInfo = await getCachedAirports([...codes]);
  const countryByCode = new Map<string, string>();
  for (const [code, data] of airportInfo.entries()) {
    if (data?.country) countryByCode.set(code, data.country);
  }
  return countryByCode;
}

export async function resolveAirportsVisitedCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "airportsVisitedCount");
  const rows = await loadGeoIdentityRows(userId);
  const matched = rows.map((r) => {
    const dep = r.depIata || r.depIcao;
    const arr = r.arrIata || r.arrIcao;
    const credits = [...new Set([dep, arr].filter((c): c is string => Boolean(c)))];
    return { id: r.id, date: flightDateOf(r.departureTime), credits };
  });
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
    matched,
    page
  );
  const value = new Set(matched.flatMap((m) => m.credits)).size;
  return {
    measure: {
      kind: "metric",
      key: "airportsVisitedCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.airportsVisitedCount" },
      unit: "airports",
      value,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedRowCount, credits: omittedCredits },
    unattributed: [],
    page,
  };
}

export async function resolveFlightCountriesVisitedCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "flightCountriesVisitedCount");
  const rows = await loadGeoIdentityRows(userId);
  const countryByCode = await loadAirportCodeMap(rows);
  const matched = rows.map((r) => {
    const dep = r.depIata || r.depIcao;
    const arr = r.arrIata || r.arrIcao;
    const depCountry = dep ? countryByCode.get(dep) : undefined;
    const arrCountry = arr ? countryByCode.get(arr) : undefined;
    const credits = [...new Set([depCountry, arrCountry].filter((c): c is string => Boolean(c)))];
    return { id: r.id, date: flightDateOf(r.departureTime), credits };
  });
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
    matched,
    page
  );
  const value = new Set(matched.flatMap((m) => m.credits)).size;
  return {
    measure: {
      kind: "metric",
      key: "flightCountriesVisitedCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.flightCountriesVisitedCount" },
      unit: "countries",
      value,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedRowCount, credits: omittedCredits },
    unattributed: [],
    page,
  };
}

/**
 * Continent credit mirrors `calculateAirportStats`'s own `continentOfAirport`
 * (`"Other"` for an airport the continent table cannot place) — but "Other"
 * itself is not counted (`continentCount: [...keys()].filter(c => c !==
 * "Other").length`), so a flight touching only unplaceable airports credits
 * nothing at all, exactly as it contributes nothing to that final count.
 */
export async function resolveContinentsVisitedCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "continentsVisitedCount");
  const rows = await loadGeoIdentityRows(userId);
  const codes = new Set<string>();
  for (const r of rows) {
    if (r.depIata) codes.add(r.depIata);
    if (r.depIcao && !r.depIata) codes.add(r.depIcao);
    if (r.arrIata) codes.add(r.arrIata);
    if (r.arrIcao && !r.arrIata) codes.add(r.arrIcao);
  }
  const airportInfo = await getCachedAirports([...codes]);
  const continentOf = (code: string | null): string | null => {
    if (!code) return null;
    const info = airportInfo.get(code);
    if (!info) return null;
    return getContinent(info.lat, info.lon, info.country);
  };

  const matched = rows.map((r) => {
    const dep = r.depIata || r.depIcao;
    const arr = r.arrIata || r.arrIcao;
    const credits = [
      ...new Set([continentOf(dep), continentOf(arr)].filter((c): c is string => Boolean(c))),
    ];
    return { id: r.id, date: flightDateOf(r.departureTime), credits };
  });
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
    matched,
    page
  );
  const value = new Set(matched.flatMap((m) => m.credits)).size;
  return {
    measure: {
      kind: "metric",
      key: "continentsVisitedCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.continentsVisitedCount" },
      unit: "continents",
      value,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedRowCount, credits: omittedCredits },
    unattributed: [],
    page,
  };
}

import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { normalizeCountrySet } from "../../shared/countryEvidence";
import { calculateCruiseStats, type CruiseStats } from "../../utils/cruiseStats";
import { getBaseCurrency } from "../fx/snapshot";
import { loadCruiseStatsData, type CruiseStatsRow } from "../stats/cruiseStatsData";
import type { PagingParams } from "./paging";
import { cruiseEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The ten served cruise-tab measures (task 7b-3).
 *
 * Eight of them are `calculateCruiseStats`'s own figures, and this file
 * re-derives none of them. It runs the calculator TWICE: once over the whole
 * scoped population for `measure.value`, and once per cruise for what that
 * cruise contributed. Every accumulator those eight read is per-cruise
 * independent — sea days, calendar days and distance ADD, ports, ships, lines
 * and countries UNION — so the per-cruise runs reconstruct the total exactly,
 * and a rule that changes in `utils/cruiseStats.ts` moves the tile and the
 * panel together by construction. A predicate copied into a resolver would
 * drift the day the calculator changed, and the drift would be invisible: the
 * tile and the panel would simply disagree, which is what the panel exists to
 * make impossible.
 *
 * The other two come from the CLIENT fold (`lib/stats/cruiseStatsDetail.ts`)
 * and each carries its own note, because in both cases what the fold renders
 * and what the registry names are not the same shape.
 */

interface ScopedCruises {
  rows: CruiseStatsRow[];
  total: CruiseStats;
  /** That cruise's own run of the calculator, keyed by cruise id. */
  own: Map<string, CruiseStats>;
}

async function loadScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<ScopedCruises> {
  const year = readYearScope(scope, key);
  const { rows, userBirthday } = await loadCruiseStatsData(userId, year);
  const total = calculateCruiseStats(
    rows.map((r) => r.input),
    userBirthday
  );
  const own = new Map<string, CruiseStats>(
    rows.map((r) => [r.id, calculateCruiseStats([r.input], userBirthday)])
  );
  return { rows, total, own };
}

/** The panel's row for one cruise, with whatever this measure credits it. */
function entryOf(
  row: CruiseStatsRow,
  fields: Partial<Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">>
): EvidenceEntry {
  return cruiseEvidenceEntry(
    { id: row.id, label: row.label, startDate: row.startDate },
    { ...fields, subtitle: fields.subtitle ?? null }
  );
}

/** A `sum` measure that reads one accumulator off the per-cruise stats. */
async function cruiseSum(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams,
  key: string,
  unit: string,
  read: (stats: CruiseStats) => number
): Promise<EvidenceResponse> {
  const { rows, total, own } = await loadScoped(userId, scope, key);
  const entries = rows.map((row) => entryOf(row, { contribution: read(own.get(row.id)!) }));
  return domainSumEvidence({ key, unit, scope, page, entries, value: read(total) });
}

/** A `distinct` measure that reads one credited SET off the per-cruise stats. */
async function cruiseDistinct(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams,
  key: string,
  unit: string,
  read: (stats: CruiseStats) => string[],
  value?: (stats: CruiseStats) => number
): Promise<EvidenceResponse> {
  const { rows, total, own } = await loadScoped(userId, scope, key);
  const entries = rows.map((row) => entryOf(row, { credits: read(own.get(row.id)!) }));
  return domainDistinctEvidence({
    key,
    unit,
    scope,
    page,
    entries,
    value: value ? value(total) : undefined,
  });
}

/** One row each — `cruisesCount` is `cruises.length` and nothing else. */
export function resolveCruiseCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseSum(userId, scope, page, "cruiseCount", "cruises", (s) => s.cruisesCount);
}

/**
 * Kilometres between consecutive PORT CALLS. A sea day adds none — it sits
 * inside the leg between the ports either side of it — and an unresolved port
 * call adds none either, because it has no coordinates to measure from. The
 * tile rounds the total once; the per-cruise contributions stay raw, which is
 * what `assertSumInvariant` checks by rounding both sides rather than each row.
 */
export function resolveCruiseDistanceKmTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseSum(userId, scope, page, "cruiseDistanceKmTotal", "km", (s) => s.totalDistanceKm);
}

/**
 * Sea-day STOP ROWS, not calendar days. A cruise with no dates still has them,
 * which is why this figure and `cruiseTotalDays` can disagree on the same
 * itinerary — the donut on the tab caps its own ratio for exactly that reason.
 */
export function resolveCruiseSeaDaysTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseSum(userId, scope, page, "cruiseSeaDaysTotal", "days", (s) => s.seaDays);
}

/**
 * Calendar days, inclusive of both ends — a Saturday-to-Sunday trip is two.
 * A cruise missing either date contributes 0 rather than a guess; that is the
 * calculator's own rule and the row stays in the list saying so.
 */
export function resolveCruiseTotalDays(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseSum(userId, scope, page, "cruiseTotalDays", "days", (s) => s.totalCruiseDays);
}

/**
 * Distinct CATALOGUE ports. An unresolved port call — the third state of the
 * cruise-stop invariant, a name imported that matched nothing — is a real call
 * and counts in `totalPortCalls`, but it has no catalogue id and therefore
 * credits nothing here, because `cruisePortsUnique` is keyed by that id. A
 * port called at on two cruises is credited by both and counted once, which is
 * the whole reason this is `distinct` and not a sum.
 */
export function resolveCruisePortsUniqueCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseDistinct(userId, scope, page, "cruisePortsUniqueCount", "ports", (s) =>
    [...s.ports].map(String)
  );
}

/**
 * A cruise credits the one ship it sailed on; a cruise with none credits
 * nothing. Read off the ROW rather than off the stats object, because that is
 * where the calculator itself reads it — `if (cruise.shipId !== null)
 * shipIds.add(cruise.shipId)` — and `CruiseStats` reports only the size of
 * that set.
 */
export async function resolveCruiseShipsUniqueCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "cruiseShipsUniqueCount";
  const { rows, total } = await loadScoped(userId, scope, key);
  const entries = rows.map((row) =>
    entryOf(row, { credits: row.input.shipId === null ? [] : [String(row.input.shipId)] })
  );
  return domainDistinctEvidence({
    key,
    unit: "ships",
    scope,
    page,
    entries,
    value: total.cruiseShipsUnique,
  });
}

/** A cruise credits the one line it sailed with; the calculator keeps the set. */
export function resolveCruiseLinesUniqueCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseDistinct(userId, scope, page, "cruiseLinesUniqueCount", "lines", (s) => [
    ...s.cruiseLines,
  ]);
}

/**
 * Countries, folded to ISO codes — which is what the TILE counts
 * (`(countriesIso ?? countries).length`), not the raw catalogue names. The
 * catalogue carries both "United States" and "United States of America", so
 * counting names reported one country too many and disagreed with the
 * cross-domain tile on the overview, which folds. A port whose country cannot
 * be placed is dropped from the count rather than counted under its raw name,
 * because an unresolvable name cannot be deduplicated against anything.
 */
export function resolveCruiseCountriesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return cruiseDistinct(
    userId,
    scope,
    page,
    "cruiseCountriesCount",
    "countries",
    (s) => [...normalizeCountrySet(s.countries)],
    (s) => normalizeCountrySet(s.countries).size
  );
}

/**
 * Companions, summed across the cruises they came on.
 *
 * The fold (`deriveCruiseStats`) folds the same names into a
 * `Map<name, cruises>` and `CruiseFunSection` draws it as a ranked list, so
 * there is no single companion figure on that surface — this total is the sum
 * of that list's values, one row per cruise. A name that came along twice is
 * two companion slots here and one bar with a "2" there; both are the same
 * arithmetic read at different grain.
 */
export async function resolveCruiseCompanionCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "cruiseCompanionCount";
  const year = readYearScope(scope, key);
  const { rows } = await loadCruiseStatsData(userId, year);
  const entries = rows.map((row) => entryOf(row, { contribution: row.companions.length }));
  const total = rows.reduce((sum, row) => sum + row.companions.length, 0);
  return domainSumEvidence({ key, unit: "companions", scope, page, entries, value: total });
}

/**
 * What the cruises cost, in the account's CURRENT base currency.
 *
 * The client fold deliberately produces no such total — `CruiseMoneySection`
 * reports each currency on its own line and says in as many words that it will
 * not add them, because 300 EUR plus 400 USD printed as 700 is the defect #267
 * described for flights. What makes a total honest here is the FX snapshot
 * `Cruise` gained in Task 10 (`price_base` / `fx_base_currency`), which the
 * fold does not read: the rule below is `services/trip/tripCostSuperlative.ts`'s,
 * one domain narrower.
 *
 * A snapshot in a STALE base currency counts as no snapshot at all. The stored
 * number is real, but it is real in a currency this sum is no longer being
 * computed in — adding it would be the very defect the snapshot exists to
 * prevent, one level down. Such a cruise stays in the list contributing 0,
 * with a subtitle naming the amount that could not be converted, rather than
 * disappearing: `unattributed` counts UNITS of the measure, and nobody knows
 * how many base-currency units an unconvertible price is worth, so a count of
 * CRUISES there would be added to a total of MONEY by `assertSumInvariant`.
 *
 * `value` is null — with a reason, as `businessTotalCost` answers the same
 * case — when no cruise reached the base currency at all. A zero would claim
 * the sailing was free.
 */
export async function resolveCruiseTotalSpend(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "cruiseTotalSpend";
  const year = readYearScope(scope, key);
  const [{ rows }, baseCurrency] = await Promise.all([
    loadCruiseStatsData(userId, year),
    getBaseCurrency(userId),
  ]);

  // A null or zero price is "no price", matching the fold's own
  // `typeof price === "number" && price > 0` and `bookingCost.sumByCurrency`.
  const priced = rows.filter((row) => row.price !== null && row.price > 0);
  const baseOf = (row: CruiseStatsRow): number | null =>
    row.priceBase !== null && row.fxBaseCurrency === baseCurrency ? row.priceBase : null;

  const entries = priced.map((row) => {
    const base = baseOf(row);
    return entryOf(row, {
      contribution: base ?? 0,
      subtitle:
        base === null
          ? {
              key: "evidence.subtitle.notConverted",
              values: { amount: row.price!, currency: row.currency ?? "EUR" },
            }
          : null,
    });
  });

  const contributing = priced.filter((row) => baseOf(row) !== null);
  const total = contributing.reduce((sum, row) => sum + baseOf(row)!, 0);
  return domainSumEvidence({
    key,
    unit: "currency",
    scope,
    page,
    entries,
    value: contributing.length === 0 ? null : total,
    round: (n) => Math.round(n * 100) / 100,
    // None of the three closed `UnattributedReason`s names "every price is
    // unconvertible" exactly; `notPerEntry` is the nearest fit and is used
    // here with the same note `businessTotalCost` carries, rather than
    // silently picking one. A real gap for release 2 to close.
    unattributed:
      contributing.length === 0 ? [{ count: priced.length, reason: "notPerEntry" }] : [],
  });
}

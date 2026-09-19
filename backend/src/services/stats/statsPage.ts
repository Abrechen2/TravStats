/**
 * `GET /stats/page` — the composition (forgejo#49).
 *
 * The statistics page fanned out to twelve `/stats/*` requests, and the flight
 * tab cost **fifteen** passes over the flight table for one load (measured
 * 2026-09-19 with a `prisma.$use` spy; the table is in the issue's
 * measurement). Thirteen of those passes read the identical population. This
 * file loads it ONCE — `loadStatsPageRows` — and hands the same rows to every
 * calculator, so the flight tab's fifteen become eight, and its twelve stats
 * requests become four.
 *
 * Two rules hold the saving honest, and both are the reason this is a
 * composition rather than a new set of numbers:
 *
 * 1. **Every section calls the function the per-endpoint route calls.** Not a
 *    copy of it — the same function, imported from the same place. A second
 *    implementation of "does landing somewhere count as visiting it" is how
 *    the countries KPI disagreed with the map (#233), and the ratchet test
 *    `statsPage.crossCheck.test.ts` fetches both surfaces and compares them
 *    field by field.
 * 2. **No section re-queries.** A calculator that goes back to the database
 *    defeats the point, so each one takes rows. Where a section previously
 *    narrowed its population in SQL (`aircraftRegistration != null`,
 *    `delayMinutes != null`) the narrowing is a JS filter over the loaded
 *    rows, which is the same set because both predicates are SUBSETS of the
 *    countable population.
 *
 * What is NOT here, deliberately: `/stats/summary` (a different population —
 * its year is resolved on the departure airport's clock, and its `byStatus`
 * breakdown runs on the UNFILTERED where, which this load excludes) and
 * `/stats/timeseries` (a windowed population with a day of margin at each
 * edge). Folding either in would mean either a second load — no saving — or a
 * quietly different answer under the same section name.
 */

import { normalizeHistory } from "../../utils/homeAirport";
import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from "../../utils/statsCalculator";
import { computePunctuality } from "../punctualityStats";
import { getBaseCurrency } from "../fx/snapshot";
// The shape lives in `schemas/statsPage.ts`, which assembles it from the very
// schemas the per-endpoint routes answer with — so a section here cannot drift
// from the endpoint it mirrors (forgejo#52).
import type { StatsPageResponse, StatsPageSection } from "../../schemas/statsPage";
import { loadStatsPageRows, type StatsPageRowWithClock } from "./pageRows";
import { computeSeatStats } from "./seatStats";
import { computeCountryStats } from "./countryStats";
import { computeAirlineRanking } from "./airlineRanking";
import { computeAircraftRanking } from "./aircraftRanking";
import { loadHomeAirportHistory } from "./homeAirportHistory";

/** The per-flight airline identity `/stats/airlines` groups on. */
function airlineIdentities(rows: ReadonlyArray<StatsPageRowWithClock>) {
  return rows.map((f) => ({
    airline: f.airline,
    airlineIata: f.airlineIata,
    airlineIcao: f.airlineIcao,
    count: 1,
  }));
}

export async function buildStatsPage(
  userId: string,
  sections: ReadonlySet<StatsPageSection>
): Promise<StatsPageResponse> {
  const rows = await loadStatsPageRows(userId);

  // The two extras the individual routes fetch alongside their flights. Both
  // are single-row reads on other tables, and each is read ONCE here however
  // many sections want it — `/stats/unique` and `/stats/airports` each fetched
  // the same `user_settings` row on their own.
  const needsHome = sections.has("unique") || sections.has("airports");
  const [homeHistory, baseCurrency] = await Promise.all([
    needsHome ? loadHomeAirportHistory(userId) : Promise.resolve(normalizeHistory(undefined)),
    sections.has("business") ? getBaseCurrency(userId) : Promise.resolve(""),
  ]);

  const out: StatsPageResponse = {};

  // Deliberately sequential in source order rather than one Promise.all: the
  // async calculators all resolve through the SAME cached airport catalogue,
  // and awaiting them together only multiplies the in-flight cache misses.
  // None of them touches the database.
  if (sections.has("fun")) out.fun = await calculateFunStats(rows);
  if (sections.has("business")) out.business = calculateBusinessStats(rows, baseCurrency);
  if (sections.has("unique")) out.unique = await calculateUniqueStats(rows, homeHistory);
  if (sections.has("airports")) out.airports = await calculateAirportStats(rows, homeHistory);
  if (sections.has("seats")) out.seats = computeSeatStats(rows);
  if (sections.has("countries")) out.countries = await computeCountryStats(rows);
  if (sections.has("airlines")) {
    out.airlines = computeAirlineRanking(airlineIdentities(rows), rows.length);
  }
  // `computeAircraftRanking` and `computePunctuality` each drop the rows their
  // endpoint excluded in SQL — see the subset note at the top of this file.
  if (sections.has("aircraft")) out.aircraft = computeAircraftRanking(rows);
  if (sections.has("punctuality")) out.punctuality = computePunctuality(rows);

  return out;
}

/**
 * The cruise figures that come from the ROWS rather than from the rollup.
 *
 * `GET /stats/cruise` already answers the collection questions — ports, ships,
 * lines, sea days, distance, the special crossings. What it has never carried
 * is anything about WHEN a cruise happened, what it cost, or which of them was
 * the first. Those live on the cruise row itself, and this derives them.
 *
 * MONEY IS REPORTED PER CURRENCY AND NEVER SUMMED ACROSS ONE.
 *
 * A cruise carries `price` and `currency` and nothing else: unlike a flight or
 * a lodging stay it has no FX snapshot — no `priceBase`, no `fxRate`, no
 * `fxBaseCurrency`. Adding 300 EUR to 400 USD and printing 700 is precisely
 * the defect issue #267 described for flights, and reproducing it here because
 * the field happens to be a number would be worse than showing nothing. So
 * each currency is reported on its own line, and a per-night average only
 * exists inside one currency.
 *
 * Every cruise that has a duration is counted for it; a cruise with no dates
 * contributes to the counts and to nothing that needs a day. Same rule the
 * places page follows for an undated visit, for the same reason.
 */

import type { Cruise } from "../../types/cruise";

export interface CurrencySpend {
  currency: string;
  total: number;
  cruises: number;
  nights: number;
}

export interface CruiseStatsDetail {
  /** Cruises with a usable start date, oldest first. */
  dated: Cruise[];
  undatedCount: number;

  /** Cruises that began in each calendar year, ascending. */
  byYear: Array<{ year: number; cruises: number }>;
  /** Cruises that began in each month of the year — always all twelve. */
  byMonth: number[];

  first: Cruise | null;
  longest: { cruise: Cruise; nights: number } | null;
  shortest: { cruise: Cruise; nights: number } | null;
  averageNights: number | null;

  /** Cruise with the most port calls, sea days excluded. */
  mostPorts: { cruise: Cruise; ports: number } | null;

  /** Per currency — deliberately never one total. See the note above. */
  spendByCurrency: CurrencySpend[];
  pricedCruises: number;
  unpricedCruises: number;

  cabinTypes: Map<string, number>;
  /** Highest deck slept on, and the cruise it was. */
  highestDeck: { cruise: Cruise; deck: number } | null;

  companions: Map<string, number>;
  /** Cruises that belong to a trip, out of all of them. */
  onTrips: number;
}

const MONTHS = 12;
const DAY_MS = 86_400_000;

/** Nights between two dates, or null when either is missing or unreadable. */
export function nightsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / DAY_MS);
}

export function deriveCruiseStats(cruises: readonly Cruise[]): CruiseStatsDetail {
  const dated: Cruise[] = [];
  const byYearCounts = new Map<number, number>();
  const byMonth = new Array<number>(MONTHS).fill(0);

  const spend = new Map<string, CurrencySpend>();
  const cabinTypes = new Map<string, number>();
  const companions = new Map<string, number>();

  let undatedCount = 0;
  let pricedCruises = 0;
  let onTrips = 0;

  let longest: CruiseStatsDetail["longest"] = null;
  let shortest: CruiseStatsDetail["shortest"] = null;
  let mostPorts: CruiseStatsDetail["mostPorts"] = null;
  let highestDeck: CruiseStatsDetail["highestDeck"] = null;

  let nightsSum = 0;
  let nightsCount = 0;

  for (const cruise of cruises) {
    const startMs = cruise.startDate ? Date.parse(cruise.startDate) : NaN;
    if (Number.isNaN(startMs)) {
      undatedCount += 1;
    } else {
      const start = new Date(startMs);
      dated.push(cruise);
      const year = start.getUTCFullYear();
      byYearCounts.set(year, (byYearCounts.get(year) ?? 0) + 1);
      byMonth[start.getUTCMonth()] += 1;
    }

    const nights = nightsBetween(cruise.startDate, cruise.endDate);
    if (nights !== null) {
      nightsSum += nights;
      nightsCount += 1;
      if (longest === null || nights > longest.nights) longest = { cruise, nights };
      if (shortest === null || nights < shortest.nights) shortest = { cruise, nights };
    }

    // Sea days are not port calls. Counting them would make a transatlantic
    // crossing look like the most-visited itinerary in the logbook.
    const ports = (cruise.stops ?? []).filter((s) => !s.isAtSea).length;
    if (ports > 0 && (mostPorts === null || ports > mostPorts.ports)) {
      mostPorts = { cruise, ports };
    }

    if (typeof cruise.price === "number" && cruise.price > 0) {
      pricedCruises += 1;
      const currency = cruise.currency ?? "EUR";
      const row = spend.get(currency) ?? { currency, total: 0, cruises: 0, nights: 0 };
      row.total += cruise.price;
      row.cruises += 1;
      if (nights !== null) row.nights += nights;
      spend.set(currency, row);
    }

    if (cruise.cabinType) {
      cabinTypes.set(cruise.cabinType, (cabinTypes.get(cruise.cabinType) ?? 0) + 1);
    }
    if (typeof cruise.deck === "number") {
      if (highestDeck === null || cruise.deck > highestDeck.deck) {
        highestDeck = { cruise, deck: cruise.deck };
      }
    }
    for (const name of cruise.companions ?? []) {
      companions.set(name, (companions.get(name) ?? 0) + 1);
    }
    if (cruise.tripId) onTrips += 1;
  }

  dated.sort((a, b) => Date.parse(a.startDate ?? "") - Date.parse(b.startDate ?? ""));

  return {
    dated,
    undatedCount,
    byYear: [...byYearCounts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, count]) => ({ year, cruises: count })),
    byMonth,

    first: dated[0] ?? null,
    longest,
    shortest,
    averageNights: nightsCount > 0 ? nightsSum / nightsCount : null,

    mostPorts,

    spendByCurrency: [...spend.values()].sort((a, b) => b.total - a.total),
    pricedCruises,
    unpricedCruises: cruises.length - pricedCruises,

    cabinTypes,
    highestDeck,
    companions,
    onTrips,
  };
}

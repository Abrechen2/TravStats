/**
 * The cruise figures that come from the ROWS rather than from the rollup.
 *
 * `GET /stats/cruise` already answers the collection questions — ports, ships,
 * lines, sea days, distance, the special crossings. What it has never carried
 * is anything about WHEN a cruise happened, what it cost, or which of them was
 * the first. Those live on the cruise row itself, and this derives them.
 *
 * MONEY IS REPORTED PER CURRENCY AND NEVER SUMMED ACROSS ONE **HERE**.
 *
 * What this fold has to work with is `price` and `currency`. Adding 300 EUR to
 * 400 USD and printing 700 is precisely the defect issue #267 described for
 * flights, and reproducing it because the field happens to be a number would be
 * worse than showing nothing. So each currency is reported on its own line, and
 * a per-night average only exists inside one currency.
 *
 * A cruise DOES carry an FX snapshot (`priceBase` / `fxBaseCurrency`, Task 10),
 * so an honest base-currency total is possible — but not from these rows and
 * not by this fold. It is computed on the server, arrives as `totalSpendBase`
 * on `GET /stats/cruise`, and is the one figure the money section shows as a
 * single number. This file stays out of it on purpose: two places converting
 * money is two rules.
 *
 * Every cruise that has a duration is counted for it; a cruise with no dates
 * contributes to the counts and to nothing that needs a day. Same rule the
 * places page follows for an undated visit, for the same reason.
 */

import type { Cruise } from "../../types/cruise";
import { isAmountRecorded } from "../../shared/flightPricing";
import { cruiseNights, cruiseStartMonth, listedPortCalls } from "../../shared/cruiseRowFacts";

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

  /**
   * How many of the folded cruises have not sailed: booked or running, and
   * cancelled. The fold keeps them (it is the logbook, not money spent), so
   * the counting help names them — a booking must stay distinguishable from
   * a voyage that happened.
   */
  bookedCount: number;
  cancelledCount: number;
}

const MONTHS = 12;

/**
 * Whether a price was recorded for the cruise.
 *
 * Exported because the money block needs the SAME answer outside the fold, to
 * say how many BOOKED cruises its rows leave out; the backend asks the same in
 * `services/stats/cruiseSpendBase.ts`. `null` is "no price"; 0 is a price —
 * the cruise form writes null for an empty field, so a 0 was typed on purpose.
 */
export function isPricedCruise<T extends { price: number | null }>(
  cruise: T
): cruise is T & { price: number } {
  return isAmountRecorded(cruise.price);
}

/** Nights between two dates, or null when either is missing or unreadable (`shared/cruiseRowFacts`). */
export function nightsBetween(start: string | null, end: string | null): number | null {
  return cruiseNights(start, end);
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
  let bookedCount = 0;
  let cancelledCount = 0;

  let longest: CruiseStatsDetail["longest"] = null;
  let shortest: CruiseStatsDetail["shortest"] = null;
  let mostPorts: CruiseStatsDetail["mostPorts"] = null;
  let highestDeck: CruiseStatsDetail["highestDeck"] = null;

  let nightsSum = 0;
  let nightsCount = 0;

  for (const cruise of cruises) {
    const month = cruiseStartMonth(cruise.startDate);
    if (month === null) {
      undatedCount += 1;
    } else {
      dated.push(cruise);
      const year = new Date(Date.parse(cruise.startDate ?? "")).getUTCFullYear();
      byYearCounts.set(year, (byYearCounts.get(year) ?? 0) + 1);
      byMonth[month] += 1;
    }

    const nights = nightsBetween(cruise.startDate, cruise.endDate);
    if (nights !== null) {
      nightsSum += nights;
      nightsCount += 1;
      if (longest === null || nights > longest.nights) longest = { cruise, nights };
      if (shortest === null || nights < shortest.nights) shortest = { cruise, nights };
    }

    // Sea days are not port calls (`shared/cruiseRowFacts`).
    const ports = listedPortCalls(cruise.stops);
    if (ports > 0 && (mostPorts === null || ports > mostPorts.ports)) {
      mostPorts = { cruise, ports };
    }

    if (isPricedCruise(cruise)) {
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
    if (cruise.status === "scheduled" || cruise.status === "in_progress") bookedCount += 1;
    if (cruise.status === "cancelled") cancelledCount += 1;
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
    bookedCount,
    cancelledCount,
  };
}

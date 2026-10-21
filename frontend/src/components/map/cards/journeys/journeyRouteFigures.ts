// A route's own statistics, for its map card (owner, 2026-10-21: "Fähren und
// Mietwagen sieht so wenig aus").
//
// Pure, like `journeyStats.ts`, and over the same journeys. Every figure is
// derived from the journeys that HAPPENED (the domain's counting rule) and
// ABSTAINS — null, or an empty list — when no journey carries what it needs:
// an unknown duration is not 0, and an average over the unknown ones would be
// a lie (CLAUDE.md, "Abstention is a result").
//
// Money follows the rental statistics (`rentalStats.costPerDay`,
// `rentalStatsExtra.costPerKm`): one figure PER CURRENCY, never a sum across
// two — 300 USD and 300 EUR are not "600".

import type { MapJourney } from "./journeyTypes";

export interface RankedDuration {
  journeyId: string;
  minutes: number;
}

export interface RouteDurationFigures {
  averageMin: number;
  /** How many journeys the average is over — those timed at both ends. */
  measured: number;
  /** Only from two measured journeys up; one journey is no ranking. */
  fastest: RankedDuration | null;
  slowest: RankedDuration | null;
}

export interface CurrencyFigure {
  currency: string;
  amount: number;
  /** How many rentals the figure stands on. */
  rentals: number;
}

export interface RentalRouteFigures {
  /** Mean rental length in days over the rentals whose length is known. */
  averageDays: number | null;
  /** How many rentals `averageDays` is over. */
  daysMeasured: number;
  /** Σ driven km / Σ days over the rentals with a driven-km figure. */
  kmPerDay: number | null;
  costPerDay: CurrencyFigure[];
  costPerKm: CurrencyFigure[];
}

export interface JourneyRouteFigures {
  /** The first journey that happened — null when it would repeat `last`. */
  first: MapJourney | null;
  last: MapJourney | null;
  duration: RouteDurationFigures | null;
  delay: { averageMin: number; measured: number } | null;
  /** Null for every domain but rental. */
  rental: RentalRouteFigures | null;
}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Travelled and dated, oldest first — what "first" and "last" are read from. */
function datedTravelled(journeys: readonly MapJourney[]): MapJourney[] {
  return journeys
    .filter((j) => j.travelled && j.departure !== null)
    .sort((a, b) => Date.parse(a.departure!.utc) - Date.parse(b.departure!.utc));
}

function durationFigures(travelled: readonly MapJourney[]): RouteDurationFigures | null {
  const timed = travelled.flatMap((j) =>
    j.facts.durationMin != null ? [{ journeyId: j.id, minutes: j.facts.durationMin }] : []
  );
  if (timed.length === 0) return null;
  const sum = timed.reduce((acc, d) => acc + d.minutes, 0);
  const ranked = [...timed].sort((a, b) => a.minutes - b.minutes);
  const ranking = timed.length >= 2;
  return {
    averageMin: Math.round(sum / timed.length),
    measured: timed.length,
    fastest: ranking ? ranked[0] : null,
    slowest: ranking ? ranked[ranked.length - 1] : null,
  };
}

function delayFigures(travelled: readonly MapJourney[]): JourneyRouteFigures["delay"] {
  const delays = travelled.flatMap((j) =>
    j.facts.delayMinutes != null ? [j.facts.delayMinutes] : []
  );
  if (delays.length === 0) return null;
  return {
    averageMin: round(delays.reduce((a, b) => a + b, 0) / delays.length, 1),
    measured: delays.length,
  };
}

/** Per currency: Σ amount / Σ divisor, over the rentals `pick` admits. */
function perCurrency(
  rentals: readonly MapJourney[],
  divisorOf: (j: MapJourney) => number | null,
  digits: number
): CurrencyFigure[] {
  const sums = new Map<string, { amount: number; divisor: number; rentals: number }>();
  for (const j of rentals) {
    const cost = j.facts.cost;
    const divisor = divisorOf(j);
    if (!cost || divisor === null || divisor <= 0) continue;
    const cur = sums.get(cost.currency) ?? { amount: 0, divisor: 0, rentals: 0 };
    sums.set(cost.currency, {
      amount: cur.amount + cost.amount,
      divisor: cur.divisor + divisor,
      rentals: cur.rentals + 1,
    });
  }
  return [...sums.entries()]
    .map(([currency, v]) => ({
      currency,
      amount: round(v.amount / v.divisor, digits),
      rentals: v.rentals,
    }))
    .sort((a, b) => b.rentals - a.rentals || a.currency.localeCompare(b.currency));
}

function rentalFigures(travelled: readonly MapJourney[]): RentalRouteFigures {
  const days = travelled.flatMap((j) => (j.facts.rentalDays != null ? [j.facts.rentalDays] : []));
  let km = 0;
  let kmDays = 0;
  for (const j of travelled) {
    if (j.distanceKm === null || j.facts.rentalDays == null) continue;
    km += j.distanceKm;
    kmDays += j.facts.rentalDays;
  }
  return {
    averageDays: days.length > 0 ? round(days.reduce((a, b) => a + b, 0) / days.length, 1) : null,
    daysMeasured: days.length,
    kmPerDay: kmDays > 0 ? round(km / kmDays, 1) : null,
    costPerDay: perCurrency(travelled, (j) => j.facts.rentalDays ?? null, 2),
    costPerKm: perCurrency(travelled, (j) => j.distanceKm, 2),
  };
}

export function getJourneyRouteFigures(journeys: readonly MapJourney[]): JourneyRouteFigures {
  const travelled = journeys.filter((j) => j.travelled);
  const dated = datedTravelled(journeys);
  const last = dated.length > 0 ? dated[dated.length - 1] : null;
  const first = dated.length > 1 ? dated[0] : null;
  const isRental = journeys.length > 0 && journeys.every((j) => j.domain === "rental");
  return {
    first,
    last,
    duration: isRental ? null : durationFigures(travelled),
    delay: delayFigures(travelled),
    rental: isRental ? rentalFigures(travelled) : null,
  };
}

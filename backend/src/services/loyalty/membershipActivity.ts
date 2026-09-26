/**
 * What a loyalty card has been used for, read from the logbook.
 *
 * Einstellungen → Bonusprogramme shows per card how many flights, cruises or
 * stays it covers, the nights where the domain has them, and the same per
 * calendar year — the tester's whole ask of an evaluation: "Nächte/Aufenthalte
 * pro Programm völlig" (Discord, 2026-09-26). None of it is stored; "which rows
 * does this card cover" has one home, `coverage.ts`, which the list filters
 * behind each figure's link read too.
 *
 * Abstention: `nights` is null when no counted item says how long it was, and
 * `lastActivity` is null when no counted item names a day — never 0, never a
 * guessed date. An item without a year counts in the totals and in no year,
 * so the years may add up to less than the total; that is the undated rest,
 * not a loss.
 */
import { nightsBetween } from "../../shared/stayPricing";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import type { MembershipCoverage } from "../../shared/membershipDerivation";
import {
  airlineKeys,
  cruiseCovered,
  cruiseLineKey,
  cruiseYear,
  flightCovered,
  lodgingCoverage,
  loadCoveredCruises,
  loadCoveredFlights,
  loadCoveredStays,
  stayCoveredBy,
  stayYear,
  type CoverageCard,
  type CoveredCruise,
  type CoveredFlight,
  type CoveredStay,
} from "./coverage";

export { cruiseLineKey };

export interface ActivityYear {
  year: number;
  count: number;
  /** Null for flights, and for a year none of whose items names its length. */
  nights: number | null;
}

export interface MembershipActivity {
  /** Flights, cruises or stays covered by the card that actually happened. */
  count: number;
  /** Nights across the counted stays or cruises that name theirs; null for flights. */
  nights: number | null;
  /** The latest day of counted activity (YYYY-MM-DD), or null when none names one. */
  lastActivity: string | null;
  /** The same per calendar year, newest first. Undated items appear in none. */
  years: ActivityYear[];
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Folds covered items into the totals and the per-year rows. */
class Tally {
  private count = 0;
  private nights: number | null = null;
  private lastActivity: string | null = null;
  private readonly years = new Map<number, ActivityYear>();

  add(year: number | null, nights: number | null, lastDay: Date | null): void {
    this.count += 1;
    if (nights !== null) this.nights = (this.nights ?? 0) + nights;
    if (lastDay !== null) {
      const iso = day(lastDay);
      if (this.lastActivity === null || iso > this.lastActivity) this.lastActivity = iso;
    }
    if (year === null) return;
    const row = this.years.get(year) ?? { year, count: 0, nights: null };
    this.years.set(year, {
      year,
      count: row.count + 1,
      nights: nights === null ? row.nights : (row.nights ?? 0) + nights,
    });
  }

  result(): MembershipActivity {
    return {
      count: this.count,
      nights: this.nights,
      lastActivity: this.lastActivity,
      years: [...this.years.values()].sort((a, b) => b.year - a.year),
    };
  }
}

export function flightActivity(
  airlineCodes: readonly string[],
  flights: readonly CoveredFlight[]
): MembershipActivity {
  const keys = airlineKeys(airlineCodes);
  const tally = new Tally();
  for (const flight of flights) {
    if (flightCovered(keys, flight)) tally.add(flight.year, null, flight.departureTime);
  }
  return tally.result();
}

export function cruiseActivity(
  cruiseLines: readonly string[],
  cruises: readonly CoveredCruise[]
): MembershipActivity {
  const keys = new Set(cruiseLines.map(cruiseLineKey).filter((k): k is string => k !== null));
  const tally = new Tally();
  for (const cruise of cruises) {
    if (!cruiseCovered(keys, cruise)) continue;
    // A cruise without both dates says nothing about its length; it still
    // counts as a cruise, it just adds no nights.
    const nights =
      cruise.startDate && cruise.endDate ? nightsBetween(cruise.startDate, cruise.endDate) : null;
    tally.add(cruiseYear(cruise), nights, cruise.endDate ?? cruise.startDate);
  }
  return tally.result();
}

export function lodgingActivity(
  membershipId: string,
  stays: readonly CoveredStay[],
  coverage: MembershipCoverage[],
  now?: Date
): MembershipActivity {
  const tally = new Tally();
  for (const stay of stays) {
    if (!stayCoveredBy(membershipId, stay, coverage, now)) continue;
    const timing = resolveStayTiming(stay);
    // A MONTH or YEAR stay stores placeholder dates; only a DAY stay names one.
    const lastDay = timing.precision === "DAY" ? (stay.checkOut ?? stay.checkIn) : null;
    tally.add(stayYear(stay), timing.nightsKnown ? timing.nights : null, lastDay);
  }
  return tally.result();
}

export interface ActivityCard extends CoverageCard {
  airlineCodes: string[];
  cruiseLines: string[];
}

/**
 * Activity for every card at once. Each domain's rows are loaded only when a
 * card of that domain exists, and once for all of its cards.
 */
export async function loadMembershipActivity(
  userId: string,
  cards: readonly ActivityCard[]
): Promise<Map<string, MembershipActivity>> {
  const has = (domain: string): boolean => cards.some((c) => c.domain === domain);
  const [flights, cruises, stays] = await Promise.all([
    has("flight") ? loadCoveredFlights(userId) : Promise.resolve([]),
    has("cruise") ? loadCoveredCruises(userId) : Promise.resolve([]),
    has("lodging") ? loadCoveredStays(userId) : Promise.resolve([]),
  ]);
  const coverage = lodgingCoverage(cards);

  const result = new Map<string, MembershipActivity>();
  for (const card of cards) {
    if (card.domain === "flight") result.set(card.id, flightActivity(card.airlineCodes, flights));
    else if (card.domain === "cruise")
      result.set(card.id, cruiseActivity(card.cruiseLines, cruises));
    else result.set(card.id, lodgingActivity(card.id, stays, coverage));
  }
  return result;
}

/**
 * Per-trip accounting: how long, how well covered, what it cost.
 *
 * Pure — no I/O, no Prisma. The caller loads the rows.
 *
 * ON MONEY: what an entry costs is `shared/tripCost.ts`'s rule, the same one
 * the "most expensive trip" superlative ranks on (forgejo#274) — this file
 * only lays the result out. Amounts are reported PER CURRENCY and never
 * summed across currencies: a single "this trip cost X" would need a rate for
 * every amount without a snapshot, at a date nobody recorded, so
 * "1.240 EUR + 320 CHF" is the honest answer. `unpricedEntries` says when the
 * figure is a lower bound because an entry carries no price at all.
 */
import { tripCostItems, tripSpend, type TripCostInput } from "../../shared/tripCost";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { nightTrainNights, type NightTrainFacts } from "../../shared/railRideKinds";
import { nightBusNights, type BusNightFacts } from "../../shared/busRideKinds";
import type { AccountFlight } from "./travelAccount";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A trip: its cost inputs (`cost`, the rule's own shape, already through the
 * user's domain gate) and, apart, the dated rows coverage reads — loaded in
 * one pass through the same gate, so the money and the days cannot describe
 * different entries. They are kept apart because the coverage rows are a
 * superset in shape only: pricing them instead of `cost` once let ungated
 * rows back into a total (review of forgejo#274, I1).
 */
export interface TripAccountInput {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  status: string;
  category: string | null;
  tags: string[];
  journalEntries: { mood: string | null; weather: string | null }[];
  photoCount: number;
  cost: TripCostInput;
  stays: {
    status: string;
    checkIn: Date | null;
    checkOut: Date | null;
    datePrecision: string;
    nights: number | null;
  }[];
  cruises: { status: string; startDate: Date | null; endDate: Date | null }[];
  /**
   * `depLocalDay` / `arrLocalDay` are the airports' calendar days, resolved
   * at the load exactly as for the year account (`AccountFlight`): coverage
   * asks the same question — did this flight take a night — and once answered
   * it on UTC days, so an evening hop out of Los Angeles covered a night the
   * year account rightly never counted (forgejo#266).
   */
  flights: Pick<
    AccountFlight,
    "status" | "departureTime" | "arrivalTime" | "depLocalDay" | "arrLocalDay"
  >[];
  /**
   * A night train covers the nights it ran through (forgejo#266). Like every
   * coverage row here it counts unless cancelled — a planned trip's booked
   * sleeper covers its night as a booked stay does — while the night account
   * counts completed rides only (`railCounting`), as it counts only stays
   * that are over. Coverage asks "is this night planned for", the account
   * "where was it spent".
   */
  rail: ({ status: string } & NightTrainFacts)[];
  /** A night bus covers its night likewise (forgejo#263). Optional for callers before bus. */
  bus?: ({ status: string } & BusNightFacts)[];
}

// Published by /stats/travel-account (forgejo#52).
export type { TripAccountRow, TripAccount } from "../../schemas/statsDomains";
import type { TripAccountRow, TripAccount } from "../../schemas/statsDomains";

function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function rank(counts: Map<string, number>): { key: string; count: number }[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function buildTripAccount(trips: TripAccountInput[]): TripAccount {
  const rows: TripAccountRow[] = [];
  const categoryCounts = new Map<string, { trips: number; days: number }>();
  const tagCounts = new Map<string, number>();
  const moodCounts = new Map<string, number>();
  const weatherCounts = new Map<string, number>();
  let journalEntries = 0;

  for (const trip of trips) {
    const { spendByCurrency, spendBaseByCurrency, unpricedEntries } = tripSpend(
      tripCostItems(trip.cost)
    );
    const covered = new Set<number>();

    for (const stay of trip.stays) {
      if (stay.status === "cancelled") continue;
      // Coverage is about WHICH days are accounted for, so an undated stay
      // cannot cover one — it is not known which. Its money still counts:
      // that question needs no calendar (owner rule, 2026-08-16).
      if (!resolveStayTiming(stay).walkable) continue;
      for (let c = dayKey(stay.checkIn!); c < dayKey(stay.checkOut!); c += DAY_MS) covered.add(c);
    }
    for (const cruise of trip.cruises) {
      if (cruise.status === "cancelled") continue;
      if (cruise.startDate === null || cruise.endDate === null) continue;
      for (let c = dayKey(cruise.startDate); c < dayKey(cruise.endDate); c += DAY_MS)
        covered.add(c);
    }
    for (const flight of trip.flights) {
      if (flight.status === "cancelled") continue;
      if (flight.departureTime === null || flight.arrivalTime === null) continue;
      // Local days where known, the stored instant otherwise — the year
      // account's reading (`travelAccount.ts`), so the two cannot disagree.
      const dep = dayKey(flight.depLocalDay ?? flight.departureTime);
      const arr = dayKey(flight.arrLocalDay ?? flight.arrivalTime);
      for (let c = dep; c < arr; c += DAY_MS) covered.add(c);
    }
    for (const ride of trip.rail) {
      if (ride.status === "cancelled") continue;
      for (const key of nightTrainNights(ride) ?? []) covered.add(Date.parse(`${key}T00:00:00Z`));
    }
    for (const ride of trip.bus ?? []) {
      if (ride.status === "cancelled") continue;
      for (const key of nightBusNights(ride)) covered.add(Date.parse(`${key}T00:00:00Z`));
    }

    // Two counts over the same dates, kept apart on purpose (forgejo#170).
    // DURATION is calendar days with both ends, the way the trip page and the
    // trip cards count it: the 15th to the 18th is four days. COVERAGE asks
    // where each NIGHT was spent, and a trip's last day is a departure day,
    // not a night: the same dates are three nights, the count `walkNights`
    // produces for a stay. The statistics once showed the night count under
    // "Reisedauer", so one trip lasted four days on its page and three there.
    let days: number | null = null;
    let coveredDays: number | null = null;
    let uncoveredDays: number | null = null;
    if (trip.startDate !== null && trip.endDate !== null) {
      const start = dayKey(trip.startDate);
      const end = dayKey(trip.endDate);
      const nights = Math.max(0, Math.round((end - start) / DAY_MS));
      days = nights + 1;
      let hit = 0;
      for (let c = start; c < end; c += DAY_MS) if (covered.has(c)) hit += 1;
      coveredDays = hit;
      uncoveredDays = nights - hit;
    }

    rows.push({
      id: trip.id,
      name: trip.name,
      status: trip.status,
      category: trip.category,
      days,
      coveredDays,
      uncoveredDays,
      spendByCurrency,
      spendBaseByCurrency,
      unpricedEntries,
      journalEntries: trip.journalEntries.length,
      photoCount: trip.photoCount,
    });

    // "unassigned" mirrors how the flight stats bucket a null category, rather
    // than dropping the trip out of the breakdown entirely.
    const categoryKey = trip.category ?? "unassigned";
    const cur = categoryCounts.get(categoryKey) ?? { trips: 0, days: 0 };
    categoryCounts.set(categoryKey, {
      trips: cur.trips + 1,
      days: cur.days + (days ?? 0),
    });
    for (const tag of trip.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    for (const entry of trip.journalEntries) {
      journalEntries += 1;
      if (entry.mood) moodCounts.set(entry.mood, (moodCounts.get(entry.mood) ?? 0) + 1);
      if (entry.weather)
        weatherCounts.set(entry.weather, (weatherCounts.get(entry.weather) ?? 0) + 1);
    }
  }

  const dated = rows.filter((r) => r.days !== null);
  const totalDays = dated.reduce((sum, r) => sum + (r.days ?? 0), 0);

  return {
    trips: rows,
    tripsWithDates: dated.length,
    fullyCoveredTrips: dated.filter((r) => r.uncoveredDays === 0).length,
    totalUncoveredDays: dated.reduce((sum, r) => sum + (r.uncoveredDays ?? 0), 0),
    avgTripDays: dated.length > 0 ? Math.round((totalDays / dated.length) * 10) / 10 : null,
    longestTripDays: dated.length > 0 ? Math.max(...dated.map((r) => r.days ?? 0)) : null,
    byCategory: [...categoryCounts.entries()]
      .map(([key, v]) => ({ key, trips: v.trips, days: v.days }))
      .sort((a, b) => b.trips - a.trips || a.key.localeCompare(b.key)),
    byTag: rank(tagCounts).map(({ key, count }) => ({ key, trips: count })),
    moods: rank(moodCounts),
    weather: rank(weatherCounts),
    journalEntries,
  };
}

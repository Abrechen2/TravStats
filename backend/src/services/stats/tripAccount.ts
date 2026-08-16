/**
 * Per-trip accounting: how long, how well covered, what it cost.
 *
 * Pure — no I/O, no Prisma. The caller loads the rows.
 *
 * ON MONEY: amounts are reported PER CURRENCY and never summed across
 * currencies. Only lodging stays carry an FX snapshot (`totalPriceBase` +
 * `fxRate` + `fxSource`, taken at the check-in day's rate); `Flight.price` and
 * `Cruise.price` carry an amount and a currency code and nothing else. A single
 * "this trip cost X" figure would therefore have to invent a rate for two of
 * the three domains, at some date nobody recorded. Until flights and cruises
 * get the same snapshot treatment, "1.240 EUR + 320 CHF" is the honest answer
 * and one number would be a fabricated one.
 */
import { resolveStayTiming } from "../../shared/lodgingTiming";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  stays: {
    status: string;
    checkIn: Date | null;
    checkOut: Date | null;
    datePrecision: string;
    nights: number | null;
    totalPrice: number | null;
    currency: string | null;
    totalPriceBase: number | null;
    fxBaseCurrency: string | null;
  }[];
  cruises: { status: string; startDate: Date | null; endDate: Date | null; price: number | null; currency: string | null }[];
  flights: {
    status: string;
    departureTime: Date | null;
    arrivalTime: Date | null;
    price: number | null;
    currency: string | null;
  }[];
}

export interface TripAccountRow {
  id: string;
  name: string;
  status: string;
  category: string | null;
  /** Null when the trip carries no dates at all — then coverage is unanswerable. */
  days: number | null;
  /** Days inside the trip with a hotel night, a night at sea, or a night in the air. */
  coveredDays: number | null;
  /** Days inside the trip with none of those. The nudge: something is missing here. */
  uncoveredDays: number | null;
  /** Amounts by original currency, never summed across them. */
  spendByCurrency: Record<string, number>;
  /** The lodging slice that HAS an FX snapshot, by the base currency it was taken in. */
  spendBaseByCurrency: Record<string, number>;
  journalEntries: number;
  photoCount: number;
}

export interface TripAccount {
  trips: TripAccountRow[];
  tripsWithDates: number;
  /** Trips whose every travelling day is accounted for. */
  fullyCoveredTrips: number;
  /** Total days across all trips with no record of where the night was spent. */
  totalUncoveredDays: number;
  avgTripDays: number | null;
  longestTripDays: number | null;
  byCategory: { key: string; trips: number; days: number }[];
  byTag: { key: string; trips: number }[];
  moods: { key: string; count: number }[];
  weather: { key: string; count: number }[];
  journalEntries: number;
}

function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addAmount(into: Record<string, number>, currency: string | null, amount: number | null): void {
  if (currency === null || amount === null) return;
  into[currency] = Math.round(((into[currency] ?? 0) + amount) * 100) / 100;
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
    const spendByCurrency: Record<string, number> = {};
    const spendBaseByCurrency: Record<string, number> = {};
    const covered = new Set<number>();

    for (const stay of trip.stays) {
      if (stay.status === "cancelled") continue;
      addAmount(spendByCurrency, stay.currency, stay.totalPrice);
      if (stay.totalPriceBase !== null && stay.fxBaseCurrency !== null) {
        addAmount(spendBaseByCurrency, stay.fxBaseCurrency, stay.totalPriceBase);
      }
      // Coverage is about WHICH days are accounted for, so an undated stay
      // cannot cover one — it is not known which. Its money still counts:
      // that question needs no calendar (owner rule, 2026-08-16).
      if (!resolveStayTiming(stay).walkable) continue;
      for (let c = dayKey(stay.checkIn!); c < dayKey(stay.checkOut!); c += DAY_MS) covered.add(c);
    }
    for (const cruise of trip.cruises) {
      if (cruise.status === "cancelled") continue;
      addAmount(spendByCurrency, cruise.currency, cruise.price);
      if (cruise.startDate === null || cruise.endDate === null) continue;
      for (let c = dayKey(cruise.startDate); c < dayKey(cruise.endDate); c += DAY_MS) covered.add(c);
    }
    for (const flight of trip.flights) {
      if (flight.status === "cancelled") continue;
      addAmount(spendByCurrency, flight.currency, flight.price);
      if (flight.departureTime === null || flight.arrivalTime === null) continue;
      const dep = dayKey(flight.departureTime);
      const arr = dayKey(flight.arrivalTime);
      for (let c = dep; c < arr; c += DAY_MS) covered.add(c);
    }

    // A trip's last day is a departure day, not a night — a trip from the 1st
    // to the 4th is three nights, the same count `walkNights` produces for a
    // stay over those dates.
    let days: number | null = null;
    let coveredDays: number | null = null;
    let uncoveredDays: number | null = null;
    if (trip.startDate !== null && trip.endDate !== null) {
      const start = dayKey(trip.startDate);
      const end = dayKey(trip.endDate);
      days = Math.max(0, Math.round((end - start) / DAY_MS));
      let hit = 0;
      for (let c = start; c < end; c += DAY_MS) if (covered.has(c)) hit += 1;
      coveredDays = hit;
      uncoveredDays = days - hit;
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
      if (entry.weather) weatherCounts.set(entry.weather, (weatherCounts.get(entry.weather) ?? 0) + 1);
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

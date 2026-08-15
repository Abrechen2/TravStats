/**
 * The travel account: where every night of a year was actually spent.
 *
 * This is the question the lodging domain made answerable. With flights alone
 * you can say how far someone went; with cruises you can add how long they were
 * at sea; only once hotel nights are recorded can the year be closed out —
 * so many nights in a bed away from home, so many at sea, so many in a seat,
 * and the rest at home.
 *
 * Pure — no I/O, no Prisma. The caller loads the rows.
 */
import { classifyStay } from "../../shared/lodgingCounting";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountStay {
  status: string;
  checkIn: Date;
  checkOut: Date;
}

export interface AccountCruise {
  status: string;
  startDate: Date | null;
  endDate: Date | null;
}

export interface AccountFlight {
  status: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
}

/**
 * One year's nights, split by where they were spent. The four buckets are
 * mutually exclusive and add up to the length of the year (or to the days
 * elapsed so far, for the current one).
 */
export interface TravelAccountYear {
  year: string;
  /** Days the year contributes — shortened for the current year to days elapsed. */
  days: number;
  hotelNights: number;
  seaNights: number;
  /** Nights spent in the air: a flight whose departure and arrival fall on different dates. */
  airNights: number;
  homeNights: number;
}

export interface TravelAccount {
  years: TravelAccountYear[];
  /**
   * Nights that two domains both claimed — a hotel booked over a night
   * actually spent at sea, or a red-eye out of a hotel whose check-out was
   * the next morning. Reported rather than silently resolved, because the
   * resolution below (sea beats hotel beats air) is a convention, not a fact,
   * and a large number here means the log is wrong somewhere.
   */
  contestedNights: number;
}

function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Every date from `start` (inclusive) to `end` (exclusive), as UTC-midnight ms. */
function spanDays(start: Date, end: Date, into: Set<number>): void {
  let cursor = dayKey(start);
  const last = dayKey(end);
  while (cursor < last) {
    into.add(cursor);
    cursor += DAY_MS;
  }
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * `now` bounds the account: a booking for next year is not a night spent, and
 * a year that has not happened yet has no home nights to report either.
 */
export function buildTravelAccount(input: {
  stays: AccountStay[];
  cruises: AccountCruise[];
  flights: AccountFlight[];
  now: Date;
}): TravelAccount {
  const { stays, cruises, flights, now } = input;
  const today = dayKey(now);

  const hotel = new Set<number>();
  const sea = new Set<number>();
  const air = new Set<number>();

  for (const stay of stays) {
    // The same rule every lodging figure uses: only a stay that is over counts.
    if (classifyStay({ status: stay.status, checkIn: stay.checkIn, checkOut: stay.checkOut }, now) !== "visited") {
      continue;
    }
    spanDays(stay.checkIn, stay.checkOut, hotel);
  }

  for (const cruise of cruises) {
    if (cruise.status === "cancelled" || cruise.status === "scheduled") continue;
    if (cruise.startDate === null || cruise.endDate === null) continue;
    if (dayKey(cruise.endDate) > today) continue;
    spanDays(cruise.startDate, cruise.endDate, sea);
  }

  for (const flight of flights) {
    if (flight.status !== "flown" && flight.status !== "historical") continue;
    if (flight.departureTime === null || flight.arrivalTime === null) continue;
    // A night in the air is a flight that crosses a date boundary. A day-time
    // hop does not take a night from anyone.
    const dep = dayKey(flight.departureTime);
    const arr = dayKey(flight.arrivalTime);
    if (arr <= dep || arr > today) continue;
    for (let cursor = dep; cursor < arr; cursor += DAY_MS) air.add(cursor);
  }

  // Precedence: at sea beats a hotel beats the air. A cabin is where the night
  // was actually slept when both are recorded, and a hotel bed beats a seat.
  // This is a convention — `contestedNights` says how often it had to be used.
  let contestedNights = 0;
  const byYear = new Map<string, TravelAccountYear>();

  const bump = (ms: number, field: "hotelNights" | "seaNights" | "airNights"): void => {
    const year = String(new Date(ms).getUTCFullYear());
    const row = byYear.get(year) ?? {
      year,
      days: 0,
      hotelNights: 0,
      seaNights: 0,
      airNights: 0,
      homeNights: 0,
    };
    row[field] += 1;
    byYear.set(year, row);
  };

  const claimed = new Set<number>([...sea, ...hotel, ...air]);
  for (const ms of claimed) {
    const inSea = sea.has(ms);
    const inHotel = hotel.has(ms);
    const inAir = air.has(ms);
    if ([inSea, inHotel, inAir].filter(Boolean).length > 1) contestedNights += 1;
    if (inSea) bump(ms, "seaNights");
    else if (inHotel) bump(ms, "hotelNights");
    else bump(ms, "airNights");
  }

  // Home nights are the remainder, which means every year between the first
  // and the last one with data must exist as a row — a year spent entirely at
  // home is a real answer, and leaving it out would draw a gap in the chart
  // where the truthful reading is "none".
  const years = [...byYear.keys()].map(Number);
  if (years.length > 0) {
    const first = Math.min(...years);
    const last = Math.max(...years);
    for (let y = first; y <= last; y += 1) {
      const year = String(y);
      const row = byYear.get(year) ?? {
        year,
        days: 0,
        hotelNights: 0,
        seaNights: 0,
        airNights: 0,
        homeNights: 0,
      };
      const nowYear = now.getUTCFullYear();
      row.days =
        y === nowYear
          ? Math.floor((today - Date.UTC(y, 0, 1)) / DAY_MS) + 1
          : daysInYear(y);
      row.homeNights = Math.max(
        0,
        row.days - row.hotelNights - row.seaNights - row.airNights,
      );
      byYear.set(year, row);
    }
  }

  return {
    years: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)),
    contestedNights,
  };
}

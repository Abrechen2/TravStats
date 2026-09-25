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
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { isCountableFlight } from "../../shared/flightCounting";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountStay {
  /**
   * Carried through so a night can name the row that claimed it. The account
   * itself never reads it — `attributeTravelNights` does, and the evidence
   * panel asks that question of every night the account reports.
   */
  id: string;
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
}

export interface AccountCruise {
  id: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
}

export interface AccountFlight {
  id: string;
  status: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
  /**
   * The calendar day at the DEPARTURE airport and at the ARRIVAL airport, as
   * UTC midnight — resolved by the caller through `departureClock`.
   *
   * Whether a flight took a night is a question about local clocks, and this
   * used to be decided by comparing the stored instants in UTC. An evening hop
   * from Los Angeles at 16:30 local, landing 17:30 local, is 23:30Z to 00:30Z:
   * it crossed a UTC date boundary and was billed as a night in the plane,
   * subtracted from nights at home. The mirror case, a genuine red-eye
   * departing 23:30 local and landing 00:30 local, is 06:30Z to 07:30Z on one
   * UTC day and counted as no night at all (AUD-079).
   *
   * Null where no timezone is known; the stored instant is then the best
   * available answer and is used as before.
   */
  depLocalDay: Date | null;
  arrLocalDay: Date | null;
}

/**
 * One year's nights, split by where they were spent. The four buckets are
 * mutually exclusive and add up to the length of the year (or to the days
 * elapsed so far, for the current one).
 */
// Published by /stats/travel-account (forgejo#52).
export type { TravelAccountYear, TravelAccount } from "../../schemas/statsDomains";
import type { TravelAccountYear, TravelAccount } from "../../schemas/statsDomains";

function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Every date from `start` (inclusive) to `end` (exclusive), as UTC-midnight
 * ms, each one credited to `id`.
 *
 * A `Map<day, id[]>` rather than the `Set<day>` this used to be: two stays
 * can cover the same night, and the account's own arithmetic never needed to
 * know which. The evidence panel does — "which entries produced this number"
 * is unanswerable from a set of days.
 */
function spanDays(start: Date, end: Date, id: string, into: Map<number, string[]>): void {
  let cursor = dayKey(start);
  const last = dayKey(end);
  while (cursor < last) {
    const claimants = into.get(cursor);
    if (claimants) claimants.push(id);
    else into.set(cursor, [id]);
    cursor += DAY_MS;
  }
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * A night at a FREE roadtrip station — a pitch with no booking behind it.
 * Before 2.7's audit the account knew only stays, so a week in a campervan
 * was billed as a week at home. `from`/`to` bound the night-starting days
 * `[from, to)`, as `freeStationNights` derives them; a null `from` is a night
 * that happened and cannot be placed.
 *
 * A station LINKED to a stay is never here: the stay is already in `stays`,
 * and listing it twice would bill one bed two nights.
 */
export interface AccountFreeNight {
  /** The station's id — what a night names as its claimant. */
  id: string;
  from: Date | null;
  to: Date | null;
}

export interface TravelAccountInput {
  stays: AccountStay[];
  cruises: AccountCruise[];
  flights: AccountFlight[];
  /** Optional so every caller that predates roadtrips keeps its exact answer. */
  freeNights?: AccountFreeNight[];
  now: Date;
}

/** Which bucket the precedence rule awarded a night to. */
export type NightSource = "hotel" | "sea" | "air";

export interface AttributedNight {
  /** UTC midnight of the night, in milliseconds. */
  day: number;
  /** The rows that claimed this night, per bucket; a bucket that did not claim it is absent. */
  claims: Partial<Record<NightSource, string[]>>;
  /** The winner of the precedence rule — `claims[awardedTo]` is never empty. */
  awardedTo: NightSource;
  /** More than one BUCKET claimed it, which is the only thing `contestedNights` counts. */
  contested: boolean;
}

export interface TravelNightAttribution {
  /** Ascending by day, so a caller may page it without sorting again. */
  nights: AttributedNight[];
  undatedStays: number;
}

/**
 * The account's core, one step before it is folded into years: every night
 * that was spent away from home, the rows that claimed it, and which of them
 * the precedence rule awarded it to.
 *
 * Split out of `buildTravelAccount` so the evidence panel answers from the
 * SAME walk rather than a second one. A resolver that re-derived "which stay
 * produced this night" would be a second implementation of the precedence
 * rule, and the first time the two disagreed the panel would name rows the
 * tile did not count — which is the whole defect the panel exists to make
 * impossible.
 */
export function attributeTravelNights(input: TravelAccountInput): TravelNightAttribution {
  const { stays, cruises, flights, freeNights = [], now } = input;
  const today = dayKey(now);

  const hotel = new Map<number, string[]>();
  const sea = new Map<number, string[]>();
  const air = new Map<number, string[]>();
  let undatedStays = 0;

  for (const stay of stays) {
    // The same rule every lodging figure uses: only a stay that is over counts.
    if (
      classifyStay({ status: stay.status, checkIn: stay.checkIn, checkOut: stay.checkOut }, now) !==
      "visited"
    ) {
      continue;
    }
    // The account assigns NIGHTS TO DATES, so it needs real dates. An undated
    // stay — or one known only to the month — has nights but no position for
    // them, and placing them on a placeholder would take those days away from
    // the "at home" bucket on days the user may well have been at home.
    const timing = resolveStayTiming(stay);
    if (!timing.walkable || stay.checkIn === null || stay.checkOut === null) {
      undatedStays += 1;
      continue;
    }
    spanDays(stay.checkIn, stay.checkOut, stay.id, hotel);
  }

  // A free pitch is a bed away from home too — the hotel bucket, whose tile
  // reads "nights in a bed away". Only a night that is over counts, the same
  // "check-out is past" rule every stay obeys; an undated one is reported
  // beside the undated stays, because it is the same fact: a night slept away
  // that no calendar can hold.
  for (const night of freeNights) {
    if (night.from === null || night.to === null) {
      undatedStays += 1;
      continue;
    }
    if (dayKey(night.to) > today) continue;
    spanDays(night.from, night.to, night.id, hotel);
  }

  for (const cruise of cruises) {
    if (cruise.status === "cancelled" || cruise.status === "scheduled") continue;
    if (cruise.startDate === null || cruise.endDate === null) continue;
    if (dayKey(cruise.endDate) > today) continue;
    spanDays(cruise.startDate, cruise.endDate, cruise.id, sea);
  }

  for (const flight of flights) {
    if (!isCountableFlight(flight)) continue;
    if (flight.departureTime === null || flight.arrivalTime === null) continue;
    // A night in the air is a flight that crosses a date boundary ON THE
    // CLOCKS AT EITHER END. A day-time hop does not take a night from anyone,
    // however it happens to fall in UTC.
    const dep = dayKey(flight.depLocalDay ?? flight.departureTime);
    const arr = dayKey(flight.arrLocalDay ?? flight.arrivalTime);
    if (arr <= dep || arr > today) continue;
    for (let cursor = dep; cursor < arr; cursor += DAY_MS) {
      const claimants = air.get(cursor);
      if (claimants) claimants.push(flight.id);
      else air.set(cursor, [flight.id]);
    }
  }

  // Precedence: at sea beats a hotel beats the air. A cabin is where the night
  // was actually slept when both are recorded, and a hotel bed beats a seat.
  // This is a convention — `contestedNights` says how often it had to be used.
  const claimedDays = [...new Set([...sea.keys(), ...hotel.keys(), ...air.keys()])].sort(
    (a, b) => a - b
  );
  const nights: AttributedNight[] = claimedDays.map((day) => {
    const inSea = sea.get(day);
    const inHotel = hotel.get(day);
    const inAir = air.get(day);
    const claims: Partial<Record<NightSource, string[]>> = {};
    if (inSea) claims.sea = inSea;
    if (inHotel) claims.hotel = inHotel;
    if (inAir) claims.air = inAir;
    return {
      day,
      claims,
      awardedTo: inSea ? "sea" : inHotel ? "hotel" : "air",
      contested: [inSea, inHotel, inAir].filter(Boolean).length > 1,
    };
  });

  return { nights, undatedStays };
}

/**
 * `now` bounds the account: a booking for next year is not a night spent, and
 * a year that has not happened yet has no home nights to report either.
 */
export function buildTravelAccount(input: TravelAccountInput): TravelAccount {
  const { now } = input;
  const today = dayKey(now);
  const { nights, undatedStays } = attributeTravelNights(input);

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

  const BUCKET_OF: Record<NightSource, "hotelNights" | "seaNights" | "airNights"> = {
    hotel: "hotelNights",
    sea: "seaNights",
    air: "airNights",
  };
  for (const night of nights) {
    if (night.contested) contestedNights += 1;
    bump(night.day, BUCKET_OF[night.awardedTo]);
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
        y === nowYear ? Math.floor((today - Date.UTC(y, 0, 1)) / DAY_MS) + 1 : daysInYear(y);
      row.homeNights = Math.max(0, row.days - row.hotelNights - row.seaNights - row.airNights);
      byYear.set(year, row);
    }
  }

  return {
    years: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)),
    undatedStays,
    contestedNights,
  };
}

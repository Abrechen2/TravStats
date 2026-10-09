import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming, type StayTiming } from "../../shared/lodgingTiming";
import { nightDates } from "../lodgingStats/nights";
import type { InsightStay } from "./types";

/**
 * One counted stay with everything the insight blocks read, resolved once.
 *
 * WHAT COUNTS is not decided here: `shared/lodgingCounting.ts` says a stay is
 * a fact once its check-out is past, a cancelled one is nothing, and a stay in
 * progress is still planned. `shared/lodgingTiming.ts` says what its dates are
 * good for. Every block below reads this verdict instead of asking again.
 */
export interface PreparedStay {
  stay: InsightStay;
  timing: StayTiming;
  /** UTC-midnight ms of each night, in order — only for a stay with two real dates. */
  nightDays: number[];
  /** Known nights (0 when unknown — `timing.nightsKnown` tells the two apart). */
  nights: number;
  /** The calendar year the stay can honestly be filed under, or null. */
  year: number | null;
}

export interface Prepared {
  counted: PreparedStay[];
  /** Stays whose check-out is still ahead — counted in no figure here. */
  planned: number;
  /** Trips holding at least one stay that is not over yet: not a completed trip. */
  tripsWithPlannedStays: Set<string>;
}

export function prepareStays(stays: readonly InsightStay[], now: Date): Prepared {
  const counted: PreparedStay[] = [];
  let planned = 0;
  const tripsWithPlannedStays = new Set<string>();
  for (const stay of stays) {
    const state = classifyStay(
      { status: stay.status, checkIn: stay.checkIn, checkOut: stay.checkOut },
      now
    );
    if (state === "planned") {
      planned += 1;
      if (stay.trip) tripsWithPlannedStays.add(stay.trip.id);
    }
    if (state !== "visited") continue;
    const timing = resolveStayTiming(stay);
    const nightDays = timing.walkable ? nightDates(stay.checkIn!, stay.checkOut!) : [];
    counted.push({
      stay,
      timing,
      nightDays,
      nights: timing.walkable ? nightDays.length : timing.nights,
      year: timing.canBucketByYear && timing.anchor ? timing.anchor.getUTCFullYear() : null,
    });
  }
  return { counted, planned, tripsWithPlannedStays };
}

/** `YYYY-MM-DD` of a UTC-midnight-pinned date — the hotel-local day it stands for. */
export function dayOf(value: Date | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

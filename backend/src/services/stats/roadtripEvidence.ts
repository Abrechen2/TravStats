/**
 * What a ROADTRIP STATION proves — the passport, the country drill-down, the
 * days-away count and the nights account all ask it, and all ask it here.
 *
 * The audit that raised this file found the same roadtrip counted in the
 * Stats overview (`crossDomainPopulations.ts` reads its stations' countries)
 * and nowhere else: the passport did not know the country, the nights account
 * billed a night at a free pitch as a night at home, and "days away" missed
 * the whole trip. Four readers of one record, each with its own idea of it, is
 * how that happens — so the idea lives once.
 *
 * ## The tier is structural, like every other one
 *
 * Owner rule for the passport: did the day change, yes or no — never a
 * duration. A station with a night (a linked stay, or `overnight` at a free
 * pitch) is `slept`; a station driven through is `transited`, the rung that
 * already means "on the ground, passing through". A station whose linked stay
 * was CANCELLED keeps its place on the route but loses its night, exactly as
 * `countRoadtripNights` rules — the user said the booking did not happen, not
 * that the road did not.
 *
 * ## Which clock
 *
 * Station dates are stored as UTC midnight of the day the user typed, so the
 * UTC date IS the day. No timezone is consulted, and none exists to consult.
 *
 * Pure: rows in, answers out. The loaders live beside it.
 */

import { daysBetween, type EvidenceInput } from "../../shared/countryEvidence";
import { stayNamesExactDays } from "../../shared/lodgingTiming";
import { stationState } from "../../shared/tour/roadtrip";

/** The station columns every reader here needs. Any `TripStop` select is a superset. */
export interface RoadtripStationRow {
  lodgingStayId: string | null;
  overnight: boolean;
  startDate: Date | null;
  endDate: Date | null;
  lodgingStay: {
    checkIn: Date | null;
    checkOut: Date | null;
    datePrecision: string;
    nights: number | null;
    status: string;
  } | null;
}

/** What one station attests, once it has happened. */
export interface AttestedStation {
  /** A night was spent here — a linked (not cancelled) stay, or a free pitch. */
  night: boolean;
  /** The station's first day, as UTC midnight; null when it names none. */
  at: Date | null;
  /** The days it attests, `YYYY-MM-DD`. Empty for an undated station. */
  days: string[];
}

const isoDay = (at: Date | null | undefined): string | null =>
  at && Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : null;

const isCancelled = (row: RoadtripStationRow): boolean => row.lodgingStay?.status === "cancelled";

/**
 * Has this roadtrip started? The SAME test `crossDomainPopulations.loadRoadtrips`
 * applies — earliest station start, else its stay's check-in — because a
 * roadtrip the overview calls planned must not raise a country here, and one
 * it counts must not be missing.
 */
export function roadtripHasStarted(stations: readonly RoadtripStationRow[], now: Date): boolean {
  let start: Date | null = null;
  for (const s of stations) {
    const from = s.startDate ?? s.lodgingStay?.checkIn ?? null;
    if (from && (!start || from < start)) start = from;
  }
  return !(start && start.getTime() > now.getTime());
}

/**
 * The span a station names. The station's own dates win; a linked stay's dates
 * stand in only when the stay happened AND names exact days — a MONTH
 * placeholder spans a whole month while attesting a few nights (AUD-083), and a
 * cancelled stay's dates describe a visit that did not take place.
 */
function stationSpan(row: RoadtripStationRow): { from: string | null; to: string | null } {
  const stay = row.lodgingStay;
  const usable = stay !== null && !isCancelled(row) && stayNamesExactDays(stay) ? stay : null;
  return {
    from: isoDay(row.startDate) ?? isoDay(usable?.checkIn),
    to: isoDay(row.endDate) ?? isoDay(usable?.checkOut),
  };
}

/**
 * What a station attests, or null when it has not happened yet — a station
 * further down the road of a roadtrip still under way is a plan, not a visit.
 *
 * A night station attests its whole span, clipped at today; with no end it
 * attests its start day alone (the record names no more). A pass-through
 * station attests the one day it names.
 *
 * A station whose linked stay was cancelled attests nothing: the owner's rule
 * is that a cancelled stay counts nowhere, and the roadtrip's own night count
 * (`countRoadtripNights`) already gives it no night and no place. A passport
 * that kept it as a pass-through would count a country the roadtrip does not.
 */
export function attestStation(row: RoadtripStationRow, now: Date): AttestedStation | null {
  if (isCancelled(row)) return null;
  const state = stationState(row);
  const night = state === "free" || state === "stay";
  const { from, to } = stationSpan(row);
  const first = from ?? to;
  const today = isoDay(now) as string;
  if (first !== null && first > today) return null;

  let days: string[] = [];
  if (first !== null) {
    const last = night && to !== null ? (to > today ? today : to) : first;
    days = daysBetween(first, last);
  }
  return { night, at: first ? new Date(`${first}T00:00:00Z`) : null, days };
}

/** A station as the passport reads it — its country already resolved by the loader. */
export interface PassportRoadtripStation extends AttestedStation {
  /** ISO 3166-1 alpha-2, or null when neither the point nor a stay could place it. */
  country: string | null;
}

/** The fold's inputs for every station. A station with no country contributes nothing there. */
export function roadtripEvidence(stations: readonly PassportRoadtripStation[]): EvidenceInput[] {
  return stations.map((s) => ({
    country: s.country,
    kind: "roadtrip",
    tier: s.night ? "slept" : "transited",
    at: s.at,
    days: s.days,
  }));
}

/**
 * The nights a FREE station was spent away, for the nights account — the rule
 * `countRoadtripNights` counts by: its dates, at least one night, and one night
 * when it carries no end. A stay station is not here: the stay itself is
 * already in the account, and counting it twice would bill one bed two nights.
 *
 * Returned as the span of night-starting days `[from, to)`; null `from` means
 * the night happened but cannot be placed on a calendar.
 */
export function freeStationNights(
  row: RoadtripStationRow
): { from: Date | null; to: Date | null } | null {
  if (stationState(row) !== "free") return null;
  const from = isoDay(row.startDate);
  if (from === null) return { from: null, to: null };
  const start = new Date(`${from}T00:00:00Z`);
  const end = isoDay(row.endDate);
  const oneNightLater = new Date(start.getTime() + 86_400_000);
  const to = end !== null && end > from ? new Date(`${end}T00:00:00Z`) : oneNightLater;
  return { from: start, to };
}

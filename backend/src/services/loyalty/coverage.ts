/**
 * Which logbook rows a loyalty card covers — the ONE home of that question.
 *
 * Two readers ask it: the card's activity in Einstellungen → Bonusprogramme
 * ("24 Nächte 2024") and the list filter behind the link on that figure
 * (`GET /lodging?membershipId=`, `GET /flights?membershipId=`). If the two
 * answered with rules of their own, the link would open a list that disagrees
 * with the number it was clicked from.
 *
 * The rules underneath are the statistics' own: `isCountableFlight` /
 * `isCountableCruise` / `classifyStay` for "did it happen", `airlineGroupKey`
 * for "which airline was this", `deriveStayMembership` for "which hotel card
 * covered this stay". The calendar year is each domain's own answer:
 *   - a flight: the DEPARTURE AIRPORT'S calendar (`airportCalendarDay`,
 *     forgejo#46) — the logbook's year filter reads the same clock;
 *   - a stay: the timing anchor (`resolveStayTiming`), as the lodging
 *     statistics bucket it; an undated stay has no year;
 *   - a cruise: the UTC year of its start day, as `utils/cruiseStats.ts`.
 */
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { airlineGroupKey } from "../../shared/airlineNormalize";
import { countableCruiseWhere, isCountableCruise } from "../../shared/cruiseCounting";
import { countableFlightWhere, isCountableFlight } from "../../shared/flightCounting";
import { countableRailWhere, isCountableRail, stationDayKey } from "../../shared/railCounting";
import { operatorKey } from "../../shared/railRideKinds";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { deriveStayMembership, type MembershipCoverage } from "../../shared/membershipDerivation";
import { airlineResolvers } from "../../utils/airlineNormalize";
import type { FlightTimeSemantics } from "../../utils/timezone";
import { airportCalendarDay, withDepartureClock } from "../stats/departureClock";

export interface CoveredFlight {
  id: string;
  status: string;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureTime: Date | null;
  /** Calendar year on the departure airport's clock; null without a departure time. */
  year: number | null;
}

export interface CoveredCruise {
  status: string;
  /** The cruise's own line, else its ship's — the rule the cruise list draws. */
  line: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

/** A train ride as a rail card reads it (forgejo#132 item 23). */
export interface CoveredRide {
  status: string;
  operator: string | null;
  /** `YYYY-MM-DD` it left on, on the departure station's calendar. */
  day: string;
}

export interface CoveredStay {
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
  membershipId: string | null;
  membershipOptOut: boolean;
  lodgingId: string;
  lodgingChainId: number | null;
}

/** The shape a hotel card is loaded in to compete for stays. */
export interface CoverageCard {
  id: string;
  domain: string;
  createdAt: Date;
  chains: { chainId: number }[];
  lodgings: { lodgingId: string }[];
}

/** Normalised cruise-line key: the line is free text on both sides. */
export function cruiseLineKey(line: string | null | undefined): string | null {
  const key = line?.trim().toLowerCase();
  return key ? key : null;
}

/** The airline identities a flight card covers, in `airlineGroupKey`'s form. */
export function airlineKeys(airlineCodes: readonly string[]): Set<string> {
  return new Set(airlineCodes.map((code) => `iata:${code.toUpperCase()}`));
}

export function flightCovered(keys: ReadonlySet<string>, flight: CoveredFlight): boolean {
  if (!isCountableFlight(flight)) return false;
  const key = airlineGroupKey(flight, airlineResolvers);
  return key !== null && keys.has(key);
}

export function cruiseCovered(keys: ReadonlySet<string>, cruise: CoveredCruise): boolean {
  if (!isCountableCruise(cruise)) return false;
  const key = cruiseLineKey(cruise.line);
  return key !== null && keys.has(key);
}

/**
 * Every hotel card competes for a stay, exactly as in the statistics — the
 * oldest card covering a chain wins it — so a stay is judged against ALL of
 * the user's hotel cards, never against one alone.
 */
export function lodgingCoverage(cards: readonly CoverageCard[]): MembershipCoverage[] {
  return cards
    .filter((c) => c.domain === "lodging")
    .map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      chainIds: c.chains.map((link) => link.chainId),
      lodgingIds: c.lodgings.map((link) => link.lodgingId),
    }));
}

export function stayCoveredBy(
  membershipId: string,
  stay: CoveredStay,
  coverage: MembershipCoverage[],
  now?: Date
): boolean {
  const covering = deriveStayMembership({
    overrideId: stay.membershipId,
    optOut: stay.membershipOptOut,
    lodgingId: stay.lodgingId,
    lodgingChainId: stay.lodgingChainId,
    memberships: coverage,
  }).membershipId;
  return covering === membershipId && classifyStay(stay, now) === "visited";
}

/** The calendar year a stay counts in, or null for a stay that cannot be dated. */
export function stayYear(stay: CoveredStay): number | null {
  const timing = resolveStayTiming(stay);
  return timing.canBucketByYear && timing.anchor !== null ? timing.anchor.getUTCFullYear() : null;
}

export function cruiseYear(cruise: CoveredCruise): number | null {
  return cruise.startDate ? cruise.startDate.getUTCFullYear() : null;
}

/** Countable flights of the user (narrowed by `where`), each with its local year. */
export async function loadCoveredFlights(
  userId: string,
  where: Prisma.FlightWhereInput = {}
): Promise<CoveredFlight[]> {
  const rows = await prisma.flight.findMany({
    where: { AND: [where, { userId, ...countableFlightWhere() }] },
    select: {
      id: true,
      status: true,
      airline: true,
      airlineIata: true,
      airlineIcao: true,
      departureTime: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      depTimeSemantics: true,
    },
  });
  const clocked = await withDepartureClock(rows);
  return clocked.map((f) => ({
    id: f.id,
    status: f.status,
    airline: f.airline,
    airlineIata: f.airlineIata,
    airlineIcao: f.airlineIcao,
    departureTime: f.departureTime,
    year: f.departureTime
      ? airportCalendarDay(
          f.departureTime,
          f.depTimezone,
          f.depTimeSemantics as FlightTimeSemantics
        ).getUTCFullYear()
      : null,
  }));
}

export async function loadCoveredCruises(userId: string): Promise<CoveredCruise[]> {
  const rows = await prisma.cruise.findMany({
    where: { userId, ...countableCruiseWhere() },
    select: {
      status: true,
      cruiseLine: true,
      startDate: true,
      endDate: true,
      ship: { select: { cruiseLine: true } },
    },
  });
  return rows.map((c) => ({
    status: c.status,
    line: c.cruiseLine ?? c.ship?.cruiseLine ?? null,
    startDate: c.startDate,
    endDate: c.endDate,
  }));
}

export async function loadCoveredStays(userId: string): Promise<CoveredStay[]> {
  const rows = await prisma.lodgingStay.findMany({
    where: { userId },
    select: {
      status: true,
      checkIn: true,
      checkOut: true,
      datePrecision: true,
      nights: true,
      membershipId: true,
      membershipOptOut: true,
      lodgingId: true,
      lodging: { select: { chainId: true } },
    },
  });
  return rows.map(({ lodging, ...s }) => ({ ...s, lodgingChainId: lodging.chainId }));
}

/**
 * A rail card covers the counted rides (`shared/railCounting.ts`: completed)
 * whose operator it names, spelling folded the way the rail badges fold it
 * (`operatorKey`) — "DB  Fernverkehr" and "db fernverkehr" are one operator.
 * A ride that names no operator is covered by no card.
 */
export function rideCovered(keys: ReadonlySet<string>, ride: CoveredRide): boolean {
  if (!isCountableRail(ride)) return false;
  const key = operatorKey(ride.operator);
  return key !== null && keys.has(key);
}

export async function loadCoveredRides(userId: string): Promise<CoveredRide[]> {
  const rows = await prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: { status: true, operator: true, departureTime: true, depTimezone: true },
  });
  return rows.map((r) => ({
    status: r.status,
    operator: r.operator,
    day: stationDayKey(r.departureTime, r.depTimezone),
  }));
}

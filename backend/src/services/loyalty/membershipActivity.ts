/**
 * What a loyalty card has been used for, read from the logbook.
 *
 * The card page shows per membership how many flights, cruises or stays it
 * covers and when the last one was. None of that is stored: it is derived
 * from the same rows every statistic reads, through the same rules —
 * `isCountableFlight` / `isCountableCruise` / `classifyStay` for "did it
 * happen", `airlineGroupKey` for "which airline was this", and
 * `deriveStayMembership` for "which hotel card covered this stay". A card
 * page that counted by a rule of its own would sooner or later disagree with
 * the statistics page about the same nights.
 *
 * Abstention: `nights` is null when no counted item says how long it was, and
 * `lastActivity` is null when no counted item names a day — never 0, never a
 * guessed date.
 */
import { prisma } from "../../db";
import { airlineGroupKey } from "../../shared/airlineNormalize";
import { countableCruiseWhere, isCountableCruise } from "../../shared/cruiseCounting";
import { countableFlightWhere, isCountableFlight } from "../../shared/flightCounting";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { deriveStayMembership, type MembershipCoverage } from "../../shared/membershipDerivation";
import { nightsBetween } from "../../shared/stayPricing";
import { airlineResolvers } from "../../utils/airlineNormalize";

export interface MembershipActivity {
  /** Flights, cruises or stays covered by the card that actually happened. */
  count: number;
  /** Nights across the counted stays or cruises that name theirs; null for flights. */
  nights: number | null;
  /** The latest day of counted activity (YYYY-MM-DD), or null when none names one. */
  lastActivity: string | null;
}

export interface ActivityFlight {
  status: string;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureTime: Date | null;
}

export interface ActivityCruise {
  status: string;
  /** The cruise's own line, else its ship's — the rule the cruise list draws. */
  line: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export interface ActivityStay {
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

const day = (d: Date): string => d.toISOString().slice(0, 10);

function later(current: string | null, candidate: Date | null): string | null {
  if (candidate === null) return current;
  const iso = day(candidate);
  return current === null || iso > current ? iso : current;
}

/** Normalised cruise-line key: the line is free text on both sides. */
export function cruiseLineKey(line: string | null | undefined): string | null {
  const key = line?.trim().toLowerCase();
  return key ? key : null;
}

export function flightActivity(
  airlineCodes: readonly string[],
  flights: readonly ActivityFlight[]
): MembershipActivity {
  const keys = new Set(airlineCodes.map((code) => `iata:${code.toUpperCase()}`));
  let count = 0;
  let lastActivity: string | null = null;
  for (const flight of flights) {
    if (!isCountableFlight(flight)) continue;
    const key = airlineGroupKey(flight, airlineResolvers);
    if (key === null || !keys.has(key)) continue;
    count += 1;
    lastActivity = later(lastActivity, flight.departureTime);
  }
  return { count, nights: null, lastActivity };
}

export function cruiseActivity(
  cruiseLines: readonly string[],
  cruises: readonly ActivityCruise[]
): MembershipActivity {
  const keys = new Set(cruiseLines.map(cruiseLineKey).filter((k): k is string => k !== null));
  let count = 0;
  let nights: number | null = null;
  let lastActivity: string | null = null;
  for (const cruise of cruises) {
    if (!isCountableCruise(cruise)) continue;
    const key = cruiseLineKey(cruise.line);
    if (key === null || !keys.has(key)) continue;
    count += 1;
    // A cruise without both dates says nothing about its length; it still
    // counts as a cruise, it just adds no nights.
    if (cruise.startDate && cruise.endDate) {
      nights = (nights ?? 0) + nightsBetween(cruise.startDate, cruise.endDate);
    }
    lastActivity = later(lastActivity, cruise.endDate ?? cruise.startDate);
  }
  return { count, nights, lastActivity };
}

export function lodgingActivity(
  membershipId: string,
  stays: readonly ActivityStay[],
  coverage: MembershipCoverage[],
  now?: Date
): MembershipActivity {
  let count = 0;
  let nights: number | null = null;
  let lastActivity: string | null = null;
  for (const stay of stays) {
    const covering = deriveStayMembership({
      overrideId: stay.membershipId,
      optOut: stay.membershipOptOut,
      lodgingId: stay.lodgingId,
      lodgingChainId: stay.lodgingChainId,
      memberships: coverage,
    }).membershipId;
    if (covering !== membershipId) continue;
    if (classifyStay(stay, now) !== "visited") continue;
    count += 1;
    const timing = resolveStayTiming(stay);
    if (timing.nightsKnown) nights = (nights ?? 0) + timing.nights;
    // A MONTH or YEAR stay stores placeholder dates; only a DAY stay names one.
    if (timing.precision === "DAY")
      lastActivity = later(lastActivity, stay.checkOut ?? stay.checkIn);
  }
  return { count, nights, lastActivity };
}

export interface ActivityCard {
  id: string;
  domain: string;
  createdAt: Date;
  airlineCodes: string[];
  cruiseLines: string[];
  chains: { chainId: number }[];
  lodgings: { lodgingId: string }[];
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
    has("flight")
      ? prisma.flight.findMany({
          where: { userId, ...countableFlightWhere() },
          select: {
            status: true,
            airline: true,
            airlineIata: true,
            airlineIcao: true,
            departureTime: true,
          },
        })
      : Promise.resolve([]),
    has("cruise")
      ? prisma.cruise.findMany({
          where: { userId, ...countableCruiseWhere() },
          select: {
            status: true,
            cruiseLine: true,
            startDate: true,
            endDate: true,
            ship: { select: { cruiseLine: true } },
          },
        })
      : Promise.resolve([]),
    has("lodging")
      ? prisma.lodgingStay.findMany({
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
        })
      : Promise.resolve([]),
  ]);

  const cruiseRows: ActivityCruise[] = cruises.map((c) => ({
    status: c.status,
    line: c.cruiseLine ?? c.ship?.cruiseLine ?? null,
    startDate: c.startDate,
    endDate: c.endDate,
  }));
  const stayRows: ActivityStay[] = stays.map(({ lodging, ...s }) => ({
    ...s,
    lodgingChainId: lodging.chainId,
  }));
  // Every hotel card competes for a stay, exactly as in the statistics — the
  // oldest card covering a chain wins it, so a card's count depends on the
  // others and must be derived against all of them.
  const coverage: MembershipCoverage[] = cards
    .filter((c) => c.domain === "lodging")
    .map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      chainIds: c.chains.map((link) => link.chainId),
      lodgingIds: c.lodgings.map((link) => link.lodgingId),
    }));

  const result = new Map<string, MembershipActivity>();
  for (const card of cards) {
    if (card.domain === "flight") result.set(card.id, flightActivity(card.airlineCodes, flights));
    else if (card.domain === "cruise")
      result.set(card.id, cruiseActivity(card.cruiseLines, cruiseRows));
    else result.set(card.id, lodgingActivity(card.id, stayRows, coverage));
  }
  return result;
}

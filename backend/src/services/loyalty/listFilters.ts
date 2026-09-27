/**
 * "The stays / flights this card counts" as a list filter — the target of
 * the links beside each figure in Einstellungen → Bonusprogramme and in the
 * lodging statistics' programme table (owner, 2026-09-26: "Vielleicht ein
 * Link zu einer Liste all dieser Nächte/Aufenthalte").
 *
 * Coverage is DERIVED (a card covers a chain, the oldest card wins a stay;
 * a flight card covers airline identities), so it cannot be a SQL clause.
 * The ids are resolved here through `coverage.ts` — the same rules the
 * figures were counted by — and the list query then takes them as an id
 * restriction BEFORE it pages, so the page, its total and its facets all
 * describe the filtered set. Bounded by the account's own rows, the same
 * pattern as the flight list's local-calendar year (`departureLocalDay.ts`).
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import type { LoyaltyDomain } from "../../shared/domains";
import { operatorKey } from "../../shared/railRideKinds";
import {
  airlineKeys,
  flightCovered,
  lodgingCoverage,
  loadCoveredFlights,
  loadCoveredRides,
  loadCoveredStays,
  rideCovered,
  stayCoveredBy,
  stayYear,
} from "./coverage";

/**
 * The card, if it is this account's and of the list's kind. Anything else is
 * one 404 with a stable code: another user's id, a deleted card and a hotel
 * card on the flight list all mean "this programme is not here", and the list
 * must say so rather than show every row or none.
 */
async function ownedCard(userId: string, membershipId: string, domain: LoyaltyDomain) {
  const card = await prisma.loyaltyMembership.findFirst({
    where: { id: membershipId, userId, domain },
    select: { id: true, airlineCodes: true, railOperators: true },
  });
  if (!card) {
    throw new AppError("Loyalty membership not found", 404, "LOYALTY_MEMBERSHIP_NOT_FOUND");
  }
  return card;
}

/**
 * The stays this card counts — in `year` when given, by the year the
 * statistics file the stay under — and the hotels they belong to. The list
 * restricts its rows to the hotels AND its figures to the stays, so a list
 * opened from a card's figure repeats that figure.
 */
export async function lodgingStaysCoveredBy(
  userId: string,
  membershipId: string,
  year?: number
): Promise<{ lodgingIds: string[]; stayIds: string[] }> {
  await ownedCard(userId, membershipId, "lodging");
  const [cards, stays] = await Promise.all([
    prisma.loyaltyMembership.findMany({
      where: { userId, domain: "lodging" },
      select: {
        id: true,
        domain: true,
        createdAt: true,
        chains: { select: { chainId: true } },
        lodgings: { select: { lodgingId: true } },
      },
    }),
    loadCoveredStays(userId),
  ]);
  const coverage = lodgingCoverage(cards);
  const lodgingIds = new Set<string>();
  const stayIds: string[] = [];
  for (const stay of stays) {
    if (!stayCoveredBy(membershipId, stay, coverage)) continue;
    if (year !== undefined && stayYear(stay) !== year) continue;
    lodgingIds.add(stay.lodgingId);
    stayIds.push(stay.id);
  }
  return { lodgingIds: [...lodgingIds], stayIds };
}

/** The hotels with at least one stay this card counts (see above). */
export async function lodgingIdsCoveredBy(
  userId: string,
  membershipId: string,
  year?: number
): Promise<string[]> {
  return (await lodgingStaysCoveredBy(userId, membershipId, year)).lodgingIds;
}

/**
 * The flights this card counts, among those `where` already selects. The year
 * is left to the flight list's own local-calendar filter, which reads the same
 * clock the card's per-year figure does.
 */
export async function flightIdsCoveredBy(
  userId: string,
  membershipId: string,
  where: Prisma.FlightWhereInput
): Promise<string[]> {
  const card = await ownedCard(userId, membershipId, "flight");
  const keys = airlineKeys(card.airlineCodes);
  const flights = await loadCoveredFlights(userId, where);
  return flights.filter((f) => flightCovered(keys, f)).map((f) => f.id);
}

/**
 * The rides this card counts — its operators', counted rides only: the rows
 * behind a rail card's figures, as `railActivity` counts them. The year is
 * left to the rail list's own filter, which reads the same station calendar.
 */
export async function railIdsCoveredBy(userId: string, membershipId: string): Promise<string[]> {
  const card = await ownedCard(userId, membershipId, "rail");
  const keys = new Set(card.railOperators.map(operatorKey).filter((k): k is string => k !== null));
  const rides = await loadCoveredRides(userId);
  return rides.filter((r) => rideCovered(keys, r)).map((r) => r.id);
}

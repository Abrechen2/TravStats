/**
 * The money and night inputs of the cross-domain statistics (forgejo#399).
 *
 * Prices: rail, bus and ferry rides that happened (each domain's own
 * `countable*Where`), with their own price, currency and stored distance, and
 * whether a booking that holds a recorded price shadows it
 * (`utils/stats/crossDomain/pricePerKm.ts` explains why such a ride is left out).
 *
 * Nights: the travel account's attribution walk, unchanged (`attributeTravelNights`),
 * so these nights are exactly the ones `/stats/travel-account` reports; this only
 * looks up the country of the row that won each night.
 */
import { prisma } from "../../../db";
import { isAmountRecorded } from "../../../shared/flightPricing";
import { countableRailWhere } from "../../../shared/railCounting";
import { countableBusWhere } from "../../../shared/busCounting";
import { countableFerryWhere } from "../../../shared/ferryCounting";
import type { DomainKey } from "../../../shared/domains";
import type { PricedRide } from "../../../utils/stats/crossDomain/pricePerKm";
import {
  computeNightsByCountry,
  type NightsByCountry,
} from "../../../utils/stats/crossDomain/nightsByCountry";
import { attributeTravelNights, type NightSource } from "../travelAccount";
import type { TravelAccountData } from "../travelAccountData";

const RIDE_PRICE_SELECT = {
  price: true,
  currency: true,
  distanceKm: true,
  booking: { select: { price: true } },
} as const;

export async function loadPricedRides(
  userId: string,
  visible: ReadonlySet<DomainKey>
): Promise<PricedRide[]> {
  const [rail, bus, ferry] = await Promise.all([
    visible.has("rail")
      ? prisma.railJourney.findMany({
          where: { userId, ...countableRailWhere() },
          select: RIDE_PRICE_SELECT,
        })
      : [],
    visible.has("bus")
      ? prisma.busJourney.findMany({
          where: { userId, ...countableBusWhere() },
          select: RIDE_PRICE_SELECT,
        })
      : [],
    visible.has("ferry")
      ? prisma.ferryJourney.findMany({
          where: { userId, ...countableFerryWhere() },
          select: RIDE_PRICE_SELECT,
        })
      : [],
  ]);
  const toRide = (domain: PricedRide["domain"], rows: typeof rail): PricedRide[] =>
    rows.map((r) => ({
      domain,
      price: r.price,
      currency: r.currency,
      distanceKm: r.distanceKm,
      bookingPriced: isAmountRecorded(r.booking?.price),
    }));
  return [...toRide("rail", rail), ...toRide("bus", bus), ...toRide("ferry", ferry)];
}

const alpha2 = (raw: string | null | undefined): string | null =>
  raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;

/** A sleeper belongs to a country only when both ends are known and the same. */
function sameCountry(dep: string | null, arr: string | null): string | null {
  const a = alpha2(dep);
  const b = alpha2(arr);
  return a !== null && a === b ? a : null;
}

export async function loadNightsByCountry(
  data: TravelAccountData,
  now: Date
): Promise<NightsByCountry | null> {
  const { nights } = attributeTravelNights({ ...data, now });
  if (nights.length === 0) return null;

  const winners: Record<NightSource, Set<string>> = {
    hotel: new Set(),
    sea: new Set(),
    rail: new Set(),
    bus: new Set(),
    air: new Set(),
  };
  for (const night of nights) {
    const id = night.claims[night.awardedTo]?.[0];
    if (id !== undefined) winners[night.awardedTo].add(id);
  }
  const [stays, rail, bus] = await Promise.all([
    winners.hotel.size
      ? prisma.lodgingStay.findMany({
          where: { id: { in: [...winners.hotel] } },
          select: { id: true, lodging: { select: { isoCountryCode: true } } },
        })
      : [],
    winners.rail.size
      ? prisma.railJourney.findMany({
          where: { id: { in: [...winners.rail] } },
          select: { id: true, depCountry: true, arrCountry: true },
        })
      : [],
    winners.bus.size
      ? prisma.busJourney.findMany({
          where: { id: { in: [...winners.bus] } },
          select: { id: true, depCountry: true, arrCountry: true },
        })
      : [],
  ]);
  const byId = new Map<string, string | null>();
  for (const s of stays) byId.set(`hotel:${s.id}`, alpha2(s.lodging.isoCountryCode));
  for (const r of rail) byId.set(`rail:${r.id}`, sameCountry(r.depCountry, r.arrCountry));
  for (const b of bus) byId.set(`bus:${b.id}`, sameCountry(b.depCountry, b.arrCountry));
  return computeNightsByCountry(nights, (source, id) => byId.get(`${source}:${id}`) ?? null);
}

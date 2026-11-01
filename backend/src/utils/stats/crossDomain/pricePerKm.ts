/**
 * Spend and price per kilometre for rail, bus and ferry (forgejo#399).
 *
 * One block per (domain, currency). Amounts are grouped by their ORIGINAL
 * currency and never added across currencies (the FX rules: a converted
 * snapshot may be stale, a mixed sum is a lie).
 *
 * Which rides enter. A ride counts when it is countable (the caller applied
 * the domain's own predicate), carries a price of its OWN, and that price is
 * not shadowed by a booking price. A ride sold on a booking that holds a
 * price belongs to a ticket spanning other segments; dividing that ticket by
 * this ride's kilometres (or by the sum of some of its rides) would invent a
 * rate, so such rides are left out and counted in `bookedRides`.
 *
 * `pricePerKm` divides the spend of the rides that have BOTH a price and a
 * distance by exactly those rides' kilometres — a priced ride with no
 * distance adds to `spend` and `ridesWithoutKm` but not to the rate's
 * numerator or denominator. Distances are the stored ones (great-circle is a
 * lower bound of a track, so the rate is an upper bound; the source label is
 * the response's `distanceNote`). With no kilometres the rate is `null`.
 *
 * Abstention: a domain with no priced ride has no block at all.
 */
export type PricedDomain = "rail" | "bus" | "ferry";

export interface PricedRide {
  domain: PricedDomain;
  price: number | null;
  currency: string | null;
  distanceKm: number | null;
  /** The ride sits on a booking that holds its own recorded price. */
  bookingPriced: boolean;
}

export interface PricePerKmBlock {
  domain: PricedDomain;
  currency: string;
  rides: number;
  spend: number;
  /** Kilometres of the rides that had both a price and a distance. */
  km: number | null;
  pricePerKm: number | null;
  ridesWithoutKm: number;
}

export interface PricePerKmStats {
  blocks: PricePerKmBlock[];
  /** Rides left out because their price sits on a shared booking. */
  bookedRides: number;
}

const CURRENCY = /^[A-Za-z]{3}$/;
const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function computePricePerKm(rides: readonly PricedRide[]): PricePerKmStats | null {
  const groups = new Map<string, { block: PricePerKmBlock; kmSum: number; spendWithKm: number }>();
  let bookedRides = 0;
  for (const ride of rides) {
    if (ride.bookingPriced) {
      bookedRides += 1;
      continue;
    }
    if (ride.price === null || !Number.isFinite(ride.price) || ride.price < 0) continue;
    // A price with no (or an unreadable) currency cannot be grouped, let alone added.
    if (!ride.currency || !CURRENCY.test(ride.currency)) continue;
    const currency = ride.currency.toUpperCase();
    const id = `${ride.domain}:${currency}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        block: {
          domain: ride.domain,
          currency,
          rides: 0,
          spend: 0,
          km: null,
          pricePerKm: null,
          ridesWithoutKm: 0,
        },
        kmSum: 0,
        spendWithKm: 0,
      };
      groups.set(id, g);
    }
    g.block.rides += 1;
    g.block.spend += ride.price;
    if (ride.distanceKm !== null && Number.isFinite(ride.distanceKm) && ride.distanceKm > 0) {
      g.kmSum += ride.distanceKm;
      g.spendWithKm += ride.price;
    } else {
      g.block.ridesWithoutKm += 1;
    }
  }
  if (groups.size === 0) return null;
  const blocks = [...groups.values()]
    .map(({ block, kmSum, spendWithKm }) => ({
      ...block,
      spend: round(block.spend, 2),
      km: kmSum > 0 ? round(kmSum, 1) : null,
      pricePerKm: kmSum > 0 ? round(spendWithKm / kmSum, 4) : null,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.currency.localeCompare(b.currency));
  return { blocks, bookedRides };
}

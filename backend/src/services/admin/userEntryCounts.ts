import { prisma } from "../../db";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";

/** Entries per domain for one account; `total` is their sum. */
export interface UserEntryCounts {
  byDomain: Record<DomainKey, number>;
  total: number;
}

type CountsByUser = Map<string, number>;

const toMap = (rows: Array<{ userId: string; _count: { _all: number } }>): CountsByUser =>
  new Map(rows.map((r) => [r.userId, r._count._all]));

/**
 * How each domain's entries are counted, keyed by EVERY domain so a new domain
 * fails to compile until it says where its entries live. One grouped query per
 * table, not one count per user. Trips are not entries; roadtrips and tours are
 * the two `kind`s of one table (`trip_routes`).
 */
const COUNTERS: Record<DomainKey, () => Promise<CountsByUser>> = {
  flight: async () =>
    toMap(await prisma.flight.groupBy({ by: ["userId"], _count: { _all: true } })),
  cruise: async () =>
    toMap(await prisma.cruise.groupBy({ by: ["userId"], _count: { _all: true } })),
  lodging: async () =>
    toMap(await prisma.lodgingStay.groupBy({ by: ["userId"], _count: { _all: true } })),
  poi: async () =>
    toMap(await prisma.placeVisit.groupBy({ by: ["userId"], _count: { _all: true } })),
  roadtrip: () => countRoutes("roadtrip"),
  tour: () => countRoutes("tour"),
  rail: async () =>
    toMap(await prisma.railJourney.groupBy({ by: ["userId"], _count: { _all: true } })),
  bus: async () =>
    toMap(await prisma.busJourney.groupBy({ by: ["userId"], _count: { _all: true } })),
  ferry: async () =>
    toMap(await prisma.ferryJourney.groupBy({ by: ["userId"], _count: { _all: true } })),
  rental: async () =>
    toMap(await prisma.rentalBooking.groupBy({ by: ["userId"], _count: { _all: true } })),
};

async function countRoutes(kind: "roadtrip" | "tour"): Promise<CountsByUser> {
  return toMap(
    await prisma.tripRoute.groupBy({ by: ["userId"], where: { kind }, _count: { _all: true } })
  );
}

/** Entry counts for every account that has any; absent id = all zero. */
export async function countEntriesByUser(): Promise<Map<string, UserEntryCounts>> {
  const perDomain = await Promise.all(DOMAIN_KEYS.map((d) => COUNTERS[d]()));
  const out = new Map<string, UserEntryCounts>();
  DOMAIN_KEYS.forEach((domain, i) => {
    for (const [userId, n] of perDomain[i]) {
      const entry = out.get(userId) ?? { byDomain: emptyByDomain(), total: 0 };
      entry.byDomain[domain] = n;
      entry.total += n;
      out.set(userId, entry);
    }
  });
  return out;
}

export function emptyByDomain(): Record<DomainKey, number> {
  return Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<DomainKey, number>;
}

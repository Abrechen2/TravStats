import { prisma } from "../../db";
import { DOMAIN_KEYS, type DomainKey as Domain } from "../../shared/domains";
import logger from "../../utils/logger";
import { loadPassport } from "../stats/passportLoader";
import {
  bucketCount,
  bucketCountries,
  bucketPairings,
  type CountBucket,
  type CountriesBucket,
  type PairingsBucket,
} from "./buckets";

/**
 * The usage fields added for forgejo#315: what is actually used, not only
 * switched on. Counts only, every one bucketed — no names, ids, dates,
 * coordinates, notes or file names. Older receivers strip these keys, so the
 * ping stays valid against them.
 */
export interface UsageV2 {
  domain_buckets: Record<Domain, CountBucket>;
  passport_countries_bucket: CountriesBucket;
  trip_suggestions: { accepted: CountBucket; dismissed: CountBucket };
  companion_pairings_bucket: PairingsBucket;
}

/** Entries per domain, instance-wide. A new domain must be added here, or tsc fails. */
const DOMAIN_COUNTS: Record<Domain, () => Promise<number>> = {
  flight: () => prisma.flight.count(),
  cruise: () => prisma.cruise.count(),
  lodging: () => prisma.lodgingStay.count(),
  poi: () => prisma.placeVisit.count(),
  roadtrip: () => prisma.tripRoute.count({ where: { kind: "roadtrip" } }),
  rail: () => prisma.railJourney.count(),
  rental: () => prisma.rentalBooking.count(),
  bus: () => prisma.busJourney.count(),
  ferry: () => prisma.ferryJourney.count(),
};

/**
 * The passport is built per account and is not cheap, so a large instance is
 * sampled: the first this many accounts. The bucket is coarse enough that the
 * sample cannot move it far.
 */
const PASSPORT_SAMPLE = 50;

/** The largest passport country count of any account. A failing account is skipped. */
async function largestPassport(): Promise<number> {
  const users = await prisma.user.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
    take: PASSPORT_SAMPLE,
  });
  let largest = 0;
  for (const { id } of users) {
    try {
      const passport = await loadPassport(id);
      largest = Math.max(largest, passport.summary.visitedCountries);
    } catch (error) {
      logger.debug({ error }, "usage-stats: a passport could not be built; skipped");
    }
  }
  return largest;
}

export async function buildUsageV2(): Promise<UsageV2> {
  const [domainCounts, countries, accepted, dismissed, pairings] = await Promise.all([
    Promise.all(DOMAIN_KEYS.map(async (d) => [d, await DOMAIN_COUNTS[d]()] as const)),
    largestPassport(),
    prisma.tripSuggestionDecision.count({ where: { status: "accepted" } }),
    prisma.tripSuggestionDecision.count({ where: { status: "dismissed" } }),
    // A paired Companion holds a device-bound token; a revoked one is no pairing.
    prisma.apiToken.count({ where: { deviceId: { not: null }, revokedAt: null } }),
  ]);
  return {
    domain_buckets: Object.fromEntries(domainCounts.map(([d, n]) => [d, bucketCount(n)])) as Record<
      Domain,
      CountBucket
    >,
    passport_countries_bucket: bucketCountries(countries),
    trip_suggestions: { accepted: bucketCount(accepted), dismissed: bucketCount(dismissed) },
    companion_pairings_bucket: bucketPairings(pairings),
  };
}

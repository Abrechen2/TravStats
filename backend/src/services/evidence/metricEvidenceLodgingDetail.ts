import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { lodgingBaseAmount } from "../../shared/lodgingSpendBase";
import type { PagingParams } from "./paging";
import { domainSumEvidence } from "./domainMeasureResponse";
import {
  entryOf,
  loadScoped,
  visited,
  type ScopedLodging,
  type StayView,
} from "./metricEvidenceLodging";

/**
 * The entries behind the lodging tab's money, loyalty, quality and geography
 * tiles (forgejo#258).
 *
 * Those tiles show averages, shares, a median and extremes — the cheapest
 * night, the northernmost house — and release 1 serves only `sum` and
 * `distinct` (owner, 2026-09-18). So each one opens the POPULATION its figure
 * is computed over, every stay with what it brings to the figure in its
 * subtitle: the price per night, the chain, the four ratings, the position.
 * The cheapest night is then the lowest price in the list, the average the
 * list's own, and nothing on the panel can name a stay the figure did not
 * read.
 *
 * Every predicate is the rollup's (`utils/lodgingStats/*`), asked through the
 * same `StayView` the other lodging measures use; `measure.value` is the
 * rollup's own count wherever it reports one, so `assertSumInvariant` checks
 * the per-stay split against the figure the tab was built from.
 */

type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

interface Pick {
  contribution: number;
  subtitle?: EvidenceEntry["subtitle"];
}

/** A sum over the visited stays; `pick` returns null for a stay outside the population. */
function staySum(
  key: string,
  unit: string,
  pick: (stay: StayView, scoped: ScopedLodging) => Pick | null,
  value?: (scoped: ScopedLodging) => number
): Resolver {
  return async (userId, scope, page) => {
    const scoped = await loadScoped(userId, scope, key);
    const entries = visited(scoped.stays).flatMap((stay) => {
      const picked = pick(stay, scoped);
      return picked
        ? [entryOf(stay, { contribution: picked.contribution, subtitle: picked.subtitle ?? null })]
        : [];
    });
    const total = value
      ? value(scoped)
      : entries.reduce((sum, entry) => sum + (entry.contribution ?? 0), 0);
    return domainSumEvidence({ key, unit, scope, page, entries, value: total });
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A night's price in today's base currency, by `money.ts`'s own rule: a stay
 * that spans a night AND reaches the base currency (`lodgingBaseAmount`).
 * Anything else is no comparable price.
 */
function nightlyPrice(stay: StayView, baseCurrency: string): number | null {
  if (stay.nights <= 0) return null;
  const base = lodgingBaseAmount(stay.data, baseCurrency);
  return base === null ? null : base / stay.nights;
}

function pricedPick(stay: StayView, { baseCurrency }: ScopedLodging): Pick | null {
  const price = nightlyPrice(stay, baseCurrency);
  if (price === null) return null;
  return {
    contribution: stay.nights,
    subtitle: {
      key: stay.data.isAwardStay
        ? "evidence.subtitle.pricePerNightAward"
        : "evidence.subtitle.pricePerNight",
      values: { amount: round2(price), currency: baseCurrency },
    },
  };
}

/**
 * Nights with a comparable price — the population of the average, the median,
 * the cheapest and the dearest night. Each stay contributes its nights (the
 * median is over nights, not stays) and names its price per night.
 */
export const resolveLodgingPricedNightsTotal = staySum(
  "lodgingPricedNightsTotal",
  "nights",
  pricedPick,
  (scoped) => scoped.stats.price.pricedNights
);

/**
 * The paid nights the award value is priced at: the same stays, without the
 * award stays — a free night must not drag down the rate the other free
 * nights are valued at (`money.ts`).
 */
export const resolveLodgingPaidNightsTotal = staySum(
  "lodgingPaidNightsTotal",
  "nights",
  (stay, scoped) => (stay.data.isAwardStay ? null : pricedPick(stay, scoped))
);

/**
 * Nights in a chain hotel — the population of the chain share, the top
 * chain's share and the concentration. Each stay names its chain.
 */
export const resolveLodgingChainNightsTotal = staySum(
  "lodgingChainNightsTotal",
  "nights",
  (stay) =>
    stay.data.chainName
      ? { contribution: stay.nights, subtitle: { text: stay.data.chainName } }
      : null,
  (scoped) => scoped.stats.loyalty.chainNights
);

/** The top chain's nights — the figure under the top-chain tile. */
export const resolveLodgingTopChainNights = staySum(
  "lodgingTopChainNights",
  "nights",
  (stay, { stats }) =>
    stats.loyalty.topChain !== null && stay.data.chainName === stats.loyalty.topChain.name
      ? { contribution: stay.nights }
      : null,
  (scoped) => scoped.stats.loyalty.topChain?.nights ?? 0
);

const rating = (value: number | null): number | string => (value === null ? "–" : value);

/**
 * Stays with any of the four ratings — the population of the four averages.
 * Each average reads only the stays that carry ITS rating, so the subtitle
 * names all four and a blank one shows as a dash, never as a zero.
 */
export const resolveLodgingRatedStaysCount = staySum("lodgingRatedStaysCount", "stays", (stay) => {
  const { ratingOverall, ratingRoom, ratingBreakfast, ratingService } = stay.data;
  if ([ratingOverall, ratingRoom, ratingBreakfast, ratingService].every((r) => r === null)) {
    return null;
  }
  return {
    contribution: 1,
    subtitle: {
      key: "evidence.subtitle.ratings",
      values: {
        overall: rating(ratingOverall),
        room: rating(ratingRoom),
        breakfast: rating(ratingBreakfast),
        service: rating(ratingService),
      },
    },
  };
});

/**
 * Stays with coordinates — the population of the northernmost and
 * southernmost stay and the centre of gravity, which weighs each by its
 * nights (at least one). The count is the rollup's: every visited stay less
 * the unlocated ones it reports.
 */
export const resolveLodgingLocatedStaysCount = staySum(
  "lodgingLocatedStaysCount",
  "stays",
  (stay) =>
    stay.data.lat !== null && stay.data.lon !== null
      ? {
          contribution: 1,
          subtitle: {
            key: "evidence.subtitle.position",
            values: {
              lat: round2(stay.data.lat),
              lon: round2(stay.data.lon),
              weight: Math.max(stay.nights, 1),
            },
          },
        }
      : null,
  (scoped) => scoped.stats.staysCount - scoped.stats.geo.unlocatedStays
);

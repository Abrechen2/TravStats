import logger from "../../utils/logger";
import { prisma } from "../../db";
import { visibleDomainKeys } from "../domainVisibility";
import { getInstanceSettings } from "../instanceSettingsService";
import {
  searchBus,
  searchCruises,
  searchFerry,
  searchFlights,
  searchLodging,
  searchPlaces,
  searchRail,
  searchRentals,
  searchRoadtrips,
  searchTours,
  searchTrips,
} from "./searchers";
import {
  SEARCH_DOMAINS,
  TOTAL_CAP,
  type DomainSearcher,
  type SearchDomain,
  type SearchHit,
} from "./types";

export { DEFAULT_PER_DOMAIN, MAX_PER_DOMAIN, MIN_QUERY_LENGTH, TOTAL_CAP } from "./types";

const SEARCHERS: Record<SearchDomain, DomainSearcher> = {
  flight: searchFlights,
  cruise: searchCruises,
  lodging: searchLodging,
  poi: searchPlaces,
  rail: searchRail,
  bus: searchBus,
  ferry: searchFerry,
  rental: searchRentals,
  roadtrip: searchRoadtrips,
  tour: searchTours,
  trip: searchTrips,
};

export interface GlobalSearchResult {
  query: string;
  hits: SearchHit[];
  /** Domains that held more matches than were returned. */
  more: SearchDomain[];
  /** Domains whose search failed — the answer is incomplete for them, never "no match". */
  failed: SearchDomain[];
  /** True when the total cap cut hits off. */
  capped: boolean;
}

/**
 * The domains this account may search: the enabled, offered domains, plus
 * trips always and tours while the instance's beta switch (shared with
 * roadtrips) lets them in. Mirrors `useEnabledDomains` / `useToursVisible`.
 */
export async function searchableDomains(userId: string): Promise<SearchDomain[]> {
  const [settings, instance] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { enabledDomains: true } }),
    getInstanceSettings(),
  ]);
  const visible = new Set<SearchDomain>(
    visibleDomainKeys(settings?.enabledDomains, instance.betaFeaturesEnabled)
  );
  visible.add("trip");
  if (instance.betaFeaturesEnabled) visible.add("tour");
  return SEARCH_DOMAINS.filter((d) => visible.has(d));
}

export async function globalSearch(
  userId: string,
  q: string,
  limit: number,
  requested: readonly SearchDomain[] | undefined
): Promise<GlobalSearchResult> {
  const allowed = await searchableDomains(userId);
  const domains = requested ? allowed.filter((d) => requested.includes(d)) : allowed;

  const settled = await Promise.allSettled(domains.map((d) => SEARCHERS[d](userId, q, limit)));

  const hits: SearchHit[] = [];
  const more: SearchDomain[] = [];
  const failed: SearchDomain[] = [];
  settled.forEach((res, i) => {
    const domain = domains[i];
    if (res.status === "rejected") {
      logger.error({ err: res.reason, domain }, "global search: a domain failed");
      failed.push(domain);
      return;
    }
    hits.push(...res.value.hits);
    if (res.value.more) more.push(domain);
  });

  // Nothing answered: that is an outage, not an empty result.
  if (domains.length > 0 && failed.length === domains.length) {
    throw new Error("global search: every domain failed");
  }

  // Hits the total cap cuts off are "more" for their domains too.
  const kept = hits.slice(0, TOTAL_CAP);
  for (const cut of hits.slice(TOTAL_CAP)) {
    if (!more.includes(cut.domain)) more.push(cut.domain);
  }

  return {
    query: q,
    hits: kept,
    more,
    failed,
    capped: hits.length > TOTAL_CAP,
  };
}

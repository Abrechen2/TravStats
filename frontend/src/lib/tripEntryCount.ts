import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
import type { Trip } from "../types";

/**
 * Where a trip's count of each area comes from, keyed by EVERY domain — so a
 * new domain fails to compile here until it says whether, and how, its
 * entries count on the trip card.
 *
 * The card counted flights, cruises and stays and stopped, while the trip
 * page lists rail, rentals and roadtrips too: "Bahn – 1 Fahrt" on the page,
 * "0 Einträge" on the card (forgejo#169). The list endpoint sends each of
 * these in `_count`; the arrays are the fallback for a trip that came from
 * somewhere without one. `poi` is null: a place visit is not listed among a
 * trip's entries.
 */
const COUNT_OF: Record<DomainKey, ((trip: Trip) => number) | null> = {
  flight: (t) => t._count?.flights ?? t.flights?.length ?? 0,
  cruise: (t) => t._count?.cruises ?? t.cruises?.length ?? 0,
  lodging: (t) => t._count?.lodgingStays ?? t.lodgingStays?.length ?? 0,
  poi: null,
  roadtrip: (t) => t._count?.roadtrips ?? 0,
  rail: (t) => t._count?.railJourneys ?? t.railJourneys?.length ?? 0,
  rental: (t) => t._count?.rentalBookings ?? t.rentalBookings?.length ?? 0,
  // B2 (spec 2026-10-07 §8): the trip list's `_count` carries bus rides once TripCard counts them.
  bus: () => 0,
};

/** Each area's count, zero for an area the reader cannot see. */
export function tripEntryCounts(
  trip: Trip,
  visible: (domain: DomainKey) => boolean
): Record<DomainKey, number> {
  return Object.fromEntries(
    DOMAIN_KEYS.map((d) => [d, visible(d) ? (COUNT_OF[d]?.(trip) ?? 0) : 0])
  ) as Record<DomainKey, number>;
}

/** The card's "N Einträge": every visible area the trip page lists. */
export function tripEntryTotal(counts: Record<DomainKey, number>): number {
  return DOMAIN_KEYS.reduce((sum, d) => sum + counts[d], 0);
}

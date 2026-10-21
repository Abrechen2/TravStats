// What a journey's distance measures, in the words its own pages use.
//
// "Strecke 85 km" for a straight line between two stations and "684 km" for a
// schematic sea route read as the way travelled; the detail and statistics
// pages say "Luftlinie" and "Seeweg (Schätzung)". The card says the same, from
// the same i18n keys, so the two cannot drift.

import type { JourneyDomain, MapJourney } from "./journeyTypes";

const KEYS: Record<JourneyDomain, Record<string, string>> = {
  flight: {},
  rail: {
    great_circle: "rail:stats.sourceStraight",
    route: "rail:stats.sourceTraced",
    roadtrip: "rail:stats.sourceRoadtrip",
    user: "rail:stats.sourceTicket",
  },
  bus: {
    great_circle: "bus:distanceSource.great_circle",
    route: "bus:distanceSource.route",
    user: "bus:distanceSource.user",
  },
  ferry: {
    great_circle: "ferry:distanceSource.great_circle",
    sea_route: "ferry:distanceSource.sea_route",
    user: "ferry:distanceSource.user",
  },
  rental: {
    invoice: "rental:distance.invoice",
    agreement: "rental:distance.agreement",
    user: "rental:distance.user",
    odometer: "rental:distance.odometer",
  },
};

/** The i18n key naming a distance's source, or null when it is unknown — never a guess. */
export function distanceSourceKey(domain: JourneyDomain, source: string | null): string | null {
  if (source === null) return null;
  return KEYS[domain][source] ?? null;
}

/** The distinct sources behind a route's summed distance (travelled, measured), first seen first. */
export function routeDistanceSourceKeys(journeys: readonly MapJourney[]): string[] {
  const keys: string[] = [];
  for (const j of journeys) {
    if (!j.travelled || j.distanceKm === null) continue;
    const key = distanceSourceKey(j.domain, j.distanceSource);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

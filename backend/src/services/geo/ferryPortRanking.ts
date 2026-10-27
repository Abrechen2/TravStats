/**
 * Ranking for the ferry form's port search (`kind: "ferry_terminal"`).
 *
 * Measured against the public Photon on 2026-10-27, typing "travemünde":
 * a name search tagged `amenity=ferry_terminal` returns only the Priwall
 * river ferry and the Helsinki Vuosaari terminal, whose OSM name happens to
 * be "Finnlines Helsinki-Travemünde". The port people mean — Skandinavienkai,
 * `landuse=harbour` in the Travemünde district, its berths tagged
 * `ferry_terminal` as "Anleger 3" … "Anleger 8" — is never found by name,
 * because none of those names contains the word. Photon only finds them
 * around the place: a `/reverse` tag query centred on the Travemünde suburb.
 *
 * So the search is two-sourced (see `searchPlacesDetailed`), and this file
 * decides the order: a hit IN the town the user typed beats one that merely
 * mentions it in its name, and within the town the harbour — the port
 * itself — comes before its single berths.
 */
import { haversineKm } from "../../shared/geo/haversine";
import type { PlaceResult } from "./photon";

/** How far around the matched place the port is looked for. */
export const FERRY_PORT_RADIUS_KM = 10;

/** OSM tags that make a hit a place a ferry leaves from. */
export const FERRY_PORT_TAGS = ["amenity:ferry_terminal", "landuse:harbour"] as const;

export const foldPlaceName = (name: string | undefined): string =>
  (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The place the query names, or null. Only an exact (folded) name match
 * counts: Photon's fuzzy match answers "travemünde" with a hamlet called
 * "Trasmunde" in Spain, and centring a port search there would invent ports.
 */
export function placeNamedBy(query: string, places: readonly PlaceResult[]): PlaceResult | null {
  const wanted = foldPlaceName(query);
  if (!wanted) return null;
  return places.find((p) => foldPlaceName(p.name) === wanted) ?? null;
}

function liesInTown(hit: PlaceResult, town: string): boolean {
  return [hit.district, hit.city].some((part) => foldPlaceName(part) === town);
}

function isSameHit(a: PlaceResult, b: PlaceResult): boolean {
  if (a.externalRef && a.externalRef === b.externalRef) return true;
  return (
    foldPlaceName(a.name) === foldPlaceName(b.name) &&
    a.type === b.type &&
    haversineKm(a, b) * 1000 <= 300
  );
}

/**
 * Merge the name search (`byName`, in Photon's order) and the hits around
 * the named place (`nearby`), and order them:
 *
 * 0. a harbour lying in the typed town
 * 1. a terminal lying in the typed town
 * 2. anything else found around the town (nearest first)
 * 3. a hit that only mentions the town in its name
 *
 * Within a tier the name search keeps Photon's order and goes first.
 */
export function rankFerryPorts(
  query: string,
  byName: readonly PlaceResult[],
  nearby: readonly PlaceResult[],
  centre: { lat: number; lon: number } | null,
  limit: number
): PlaceResult[] {
  const town = foldPlaceName(query);
  const byDistance = centre
    ? [...nearby].sort((a, b) => haversineKm(centre, a) - haversineKm(centre, b))
    : [...nearby];

  const merged: { hit: PlaceResult; fromName: boolean }[] = [];
  for (const [hits, fromName] of [
    [byName, true],
    [byDistance, false],
  ] as const) {
    for (const hit of hits) {
      if (!merged.some((m) => isSameHit(m.hit, hit))) merged.push({ hit, fromName });
    }
  }

  const tier = ({ hit, fromName }: { hit: PlaceResult; fromName: boolean }): number => {
    if (liesInTown(hit, town)) return hit.type === "harbour" ? 0 : 1;
    return fromName ? 3 : 2;
  };
  return merged
    .map((entry, index) => ({ entry, index, tier: tier(entry) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry.hit);
}

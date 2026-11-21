import { prisma } from "../../../db";
import { haversineKm } from "../../../shared/geo/haversine";
import type { PlaceCategory } from "../../../shared/placeCategories";
import { stayIdentityView } from "../../dawarich/stays/identity";
import type { StayCandidate, StayIdentityView } from "../../dawarich/stays/identityCombine";
import type { SuggestionSwitchColumns } from "../../settings/suggestionSwitches";
import { knownNear, STOP_SHAPE } from "../stopPlaces/identity";
import { osmCategory } from "./osmCategory";

/**
 * What a stop was, decided once per stop and never per fix (spec V2):
 *
 *  1. a place the owner already has within `KNOWN_PLACE_M`, or carrying the
 *     venue's OSM id → a new VISIT of that place, no lookup at all;
 *  2. otherwise the V1 building-first lookup (`stayIdentityView`, shared and
 *     throttled Photon + Overpass) → a place to CREATE: the building's name,
 *     category, coordinates and OSM id, with the sub-venue as an alternative;
 *  3. a lodging beside the stop, no named venue, or only an address → nothing:
 *     no venue is invented.
 *
 * A provider that did not answer is a `failed` resolution with its reason —
 * never "no venues here". In particular a missing building layer (Overpass
 * down) defers the stop instead of falling back to nearest-node ranking,
 * which is the McCafé-for-McDonald's mistake.
 */

export type VisitAlternative = {
  name: string;
  osmRef: string | null;
  type: string | null;
  distanceM: number;
  foldedInto: string | null;
};

export type VisitPick = {
  /** `known`: an existing place of the owner; `osm`: a venue found by the lookup. */
  source: "known" | "osm";
  name: string;
  lat: number;
  lon: number;
  placeId: string | null;
  osmRef: string | null;
  type: string | null;
  category: PlaceCategory;
  isArea: boolean;
  resolved: "contains" | "folded" | null;
  /** From the stop's anchor to the venue. */
  distanceM: number;
  alternatives: VisitAlternative[];
};

export type LookupFailure = "places" | "venues";

export type VisitResolution =
  | {
      kind: "pick";
      pick: VisitPick;
      lookup: { geocoder: string; venues: string };
      /** Whether the geocoder and the building layer were asked (an own place beside the stop asks nobody). */
      lookedUp: boolean;
    }
  | { kind: "none"; why: "lodging" | "noVenue" }
  | { kind: "failed"; reason: LookupFailure }
  /** A lookup was needed and this run's budget for them was spent. */
  | { kind: "deferred" };

/** Venue states in which the building layer did not take part for a reason that is a failure. */
const VENUE_FAILURES = ["timeout", "rateLimited", "budget", "unavailable"];
const ALTERNATIVES_SHOWN = 3;

const metersBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.round(haversineKm(a, b) * 1000);

const alternativeOf = (c: StayCandidate): VisitAlternative => ({
  name: c.name,
  osmRef: c.osmRef ?? null,
  type: c.type,
  distanceM: c.distanceM,
  foldedInto: c.foldedInto ?? null,
});

export type ResolveDeps = {
  identity?: typeof stayIdentityView;
};

export async function resolveVisit(
  userId: string,
  stop: { lat: number; lon: number; fromMs: number; untilMs: number },
  switches: Pick<SuggestionSwitchColumns, "staySuggestionsImmichEvidence">,
  options: { allowLookup: boolean },
  deps: ResolveDeps = {}
): Promise<VisitResolution> {
  const known = await knownNear(userId, stop);
  const ownPlace = known.find((k) => k.kind === "place" && k.placeId);
  if (ownPlace?.placeId) {
    return {
      kind: "pick",
      lookedUp: false,
      lookup: { geocoder: "skipped", venues: "skipped" },
      pick: {
        source: "known",
        name: ownPlace.name,
        lat: ownPlace.lat,
        lon: ownPlace.lon,
        placeId: ownPlace.placeId,
        osmRef: null,
        type: null,
        category: "other",
        isArea: false,
        resolved: null,
        distanceM: ownPlace.distanceM,
        alternatives: [],
      },
    };
  }
  if (known.some((k) => k.kind === "lodging")) return { kind: "none", why: "lodging" };
  if (!options.allowLookup) return { kind: "deferred" };

  const view: StayIdentityView = await (deps.identity ?? stayIdentityView)(
    userId,
    {
      id: `stop:${stop.fromMs}-${stop.untilMs}`,
      lat: stop.lat,
      lon: stop.lon,
      sourceStartAt: new Date(stop.fromMs),
      sourceEndAt: new Date(stop.untilMs),
    },
    switches.staySuggestionsImmichEvidence,
    STOP_SHAPE
  );
  if (view.candidatesState === "degraded") return { kind: "failed", reason: "places" };
  if (VENUE_FAILURES.includes(view.venues.state)) return { kind: "failed", reason: "venues" };
  const probable = view.probable;
  if (!probable || probable.source !== "nearbyPlace") return { kind: "none", why: "noVenue" };
  const chosen = view.candidates.find((c) => c.name === probable.name);
  if (!chosen) return { kind: "none", why: "noVenue" };

  const alternatives = view.candidates
    .filter((c) => c !== chosen)
    .sort((a, b) => Number(b.foldedInto === chosen.name) - Number(a.foldedInto === chosen.name))
    .slice(0, ALTERNATIVES_SHOWN)
    .map(alternativeOf);
  const lookup = { geocoder: view.geocoder, venues: view.venues.state };
  // The same venue, already one of the owner's places (a pin set a few metres
  // off the building): a visit of that place, not a duplicate.
  const same = chosen.osmRef
    ? await prisma.place.findFirst({
        where: { userId, externalRef: `osm:${chosen.osmRef}` },
        select: { id: true, name: true, lat: true, lon: true },
      })
    : null;
  return {
    kind: "pick",
    lookup,
    lookedUp: true,
    pick: {
      source: same ? "known" : "osm",
      name: same?.name ?? chosen.name,
      lat: same?.lat ?? chosen.lat,
      lon: same?.lon ?? chosen.lon,
      placeId: same?.id ?? null,
      osmRef: chosen.osmRef ?? null,
      type: chosen.type,
      category: osmCategory(chosen.type),
      isArea: chosen.isArea === true,
      resolved: view.venues.resolved,
      distanceM: metersBetween(stop, chosen),
      alternatives,
    },
  };
}

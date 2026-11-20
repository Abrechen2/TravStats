import { haversineKm } from "../../../shared/geo/haversine";
import type { GeocodeParts } from "../../geo/nominatim";
import type { PlaceResult } from "../../geo/photon";
import type { ImmichAsset, ImmichErrorKind } from "../../immich/types";
import { contains, polygons } from "../marketVisits/geometry";
import { RADIUS_METERS } from "./detect";
import {
  areaSizeM2,
  entityOf,
  foldTarget,
  resolveVenue,
  venueName,
  type VenueElement,
  type VenueEvidence,
  type VenueState,
} from "./venueRank";

/**
 * Which place a Dawarich stay probably was (forgejo#305) — the PURE half:
 * three independent answers in, one view out, no I/O.
 *
 * The three sources answer different questions and fail independently:
 *  - Nominatim (`/geo/reverse`'s service) names the ADDRESS at the stay point;
 *  - Photon (`/geo/reverse-places`'s service) names the PLACES around it;
 *  - Immich, optionally, says where the camera was during the stay.
 *
 * Each failure stays visible as its own state rather than collapsing into
 * "nothing here": a geocoder that answered 429 says nothing about the point,
 * and an Immich that refused the key says nothing about whether photos exist
 * (the silent-failure classes, owner 2026-09-26). The view therefore carries
 * one state per source next to the combined answer.
 */

/** How many nearby places the card lists. */
export const STAY_CANDIDATE_LIMIT = 5;
/** Photon's search radius around the stay point, in km. */
export const STAY_CANDIDATE_RADIUS_KM = 0.25;
/**
 * A nearby place counts as THE probable place without photo support only
 * inside the stay detector's own radius: the cluster was found within it, so
 * a place further out is a neighbour, not the stay.
 */
export const PROBABLE_PLACE_MAX_M = RADIUS_METERS;
/**
 * A photo supports a candidate when it was taken this close to it. Tighter
 * than the stay radius on purpose: within 150 m every candidate is "near" the
 * photo, and a support that every candidate gets decides nothing.
 */
export const PHOTO_SUPPORT_RADIUS_M = 75;
/** City hints listed at most; a stay is one place, more is noise. */
const CITY_HINT_LIMIT = 3;

export type GeocoderState = "ok" | "empty" | "degraded";
export type PhotoState = "off" | "notConfigured" | "ok" | ImmichErrorKind;

export interface StayIdentityInput {
  point: { lat: number; lon: number };
  geocode: { parts: GeocodeParts | null; degraded: boolean };
  places: { results: PlaceResult[]; degraded: boolean };
  /** Photos already restricted to the stay's time window and photo radius. */
  photos: { state: PhotoState; assets: ImmichAsset[]; truncated: boolean };
  /**
   * OSM outlines and tags around the point. Absent or not usable (`state` other
   * than ok/partial) means the ranking runs as before and says why.
   */
  venues?: VenueEvidence;
}

export interface StayCandidate {
  name: string;
  type: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lon: number;
  distanceM: number;
  /** Photos of the stay taken within `PHOTO_SUPPORT_RADIUS_M`; null without photo evidence. */
  photoCount: number | null;
  /** `node/1`, `way/2`, `relation/3` when the candidate is an OSM feature. */
  osmRef?: string | null;
  /** Name of the building/venue this candidate was folded into (an alternative to it). */
  foldedInto?: string | null;
  /** True for the building/area outline the stay point lies in or the pick folded into. */
  isArea?: boolean;
}

export type ProbableSource = "nearbyPlace" | "address" | "photos";

export interface StayIdentityView {
  probable: {
    name: string;
    source: ProbableSource;
    /** True when the stay's own photos were taken at this place. */
    photoSupported: boolean;
  } | null;
  address: { address: string | null; city: string | null; country: string | null } | null;
  geocoder: GeocoderState;
  candidates: StayCandidate[];
  candidatesState: GeocoderState;
  /** Whether OSM outlines took part in the ranking, and how the venue was found. */
  venues: { state: VenueState; resolved: "contains" | "folded" | null };
  photos: {
    state: PhotoState;
    count: number;
    cities: { name: string; count: number }[];
    truncated: boolean;
  };
}

const meters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  Math.round(haversineKm(a, b) * 1000);

function located(assets: ImmichAsset[]): { lat: number; lon: number }[] {
  return assets.flatMap((asset) =>
    asset.lat !== null && asset.lon !== null ? [{ lat: asset.lat, lon: asset.lon }] : []
  );
}

/** The photos' cities, most frequent first, ties by first appearance. */
function cityHints(assets: ImmichAsset[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const city = asset.city?.trim();
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, CITY_HINT_LIMIT);
}

function candidatesOf(input: StayIdentityInput, withPhotos: boolean): StayCandidate[] {
  const positions = located(input.photos.assets);
  return input.places.results.slice(0, STAY_CANDIDATE_LIMIT).map((place) => ({
    name: place.name,
    type: place.type ?? null,
    address: place.address ?? null,
    city: place.city ?? null,
    lat: place.lat,
    lon: place.lon,
    osmRef: place.externalRef?.replace(/^osm:/, "") ?? null,
    distanceM: meters(input.point, place),
    photoCount: withPhotos
      ? positions.filter((photo) => meters(photo, place) <= PHOTO_SUPPORT_RADIUS_M).length
      : null,
  }));
}

/**
 * The probable place, in order of how specific the evidence is:
 *  1. a nearby named place the stay's photos were taken at (most photos wins,
 *     Photon's importance order breaks ties) — both sources agree;
 *  2. the first nearby named place inside the stay radius — Dawarich alone;
 *  3. the address at the stay point — the geocoder knew the street, no POI;
 *  4. the city the photos name — Immich alone, e.g. while both geocoders are
 *     down: a coarse answer, labelled as coming from the photos.
 */
function pickOf(candidates: StayCandidate[]): { c: StayCandidate; photoSupported: boolean } | null {
  const supported = candidates
    .filter((c) => (c.photoCount ?? 0) > 0)
    .reduce<StayCandidate | null>(
      (best, c) => (best === null || (c.photoCount ?? 0) > (best.photoCount ?? 0) ? c : best),
      null
    );
  if (supported) return { c: supported, photoSupported: true };
  const near = candidates.find((c) => c.distanceM <= PROBABLE_PLACE_MAX_M);
  return near ? { c: near, photoSupported: false } : null;
}

function probableOf(
  candidates: StayCandidate[],
  geocode: GeocodeParts | null,
  cities: { name: string }[]
): StayIdentityView["probable"] {
  const pick = pickOf(candidates);
  if (pick)
    return { name: pick.c.name, source: "nearbyPlace", photoSupported: pick.photoSupported };
  const street = geocode?.address ?? geocode?.city;
  if (street) return { name: street, source: "address", photoSupported: false };
  if (cities[0]) return { name: cities[0].name, source: "photos", photoSupported: true };
  return null;
}

const USABLE_VENUE_STATES: VenueState[] = ["ok", "partial"];

/** The middle of an outline's bounding box: where the building is, for the card. */
function centreOf(el: VenueElement): { lat: number; lon: number } {
  const ring = polygons(el.area!).flatMap(([outer]) => outer);
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}

function areaCandidate(
  el: VenueElement,
  input: StayIdentityInput,
  existing: StayCandidate | undefined,
  withPhotos: boolean
): StayCandidate {
  if (existing) return { ...existing, isArea: true };
  const at = contains(el.area!, input.point.lon, input.point.lat) ? input.point : centreOf(el);
  const t = el.tags;
  const photos = withPhotos ? located(input.photos.assets) : [];
  return {
    name: venueName(t),
    type: t.shop ?? t.amenity ?? t.tourism ?? t.leisure ?? t.office ?? t.craft ?? null,
    address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || null,
    city: t["addr:city"] ?? null,
    lat: at.lat,
    lon: at.lon,
    distanceM: meters(input.point, at),
    photoCount: withPhotos ? photos.filter((p) => contains(el.area!, p.lon, p.lat)).length : null,
    osmRef: el.ref,
    foldedInto: null,
    isArea: true,
  };
}

/**
 * Building first (rule 3): containment and evidence-backed folding decide
 * before photos or distance; without usable outlines the old ranking stands.
 */
function rankWithVenues(
  input: StayIdentityInput,
  base: StayCandidate[],
  withPhotos: boolean
): {
  candidates: StayCandidate[];
  probable: StayIdentityView["probable"] | null;
  resolved: "contains" | "folded" | null;
} {
  const elements = input.venues?.elements ?? [];
  const byRef = new Map(elements.map((el) => [el.ref, el]));
  const old = pickOf(base);
  const pickEl = old?.c.osmRef ? byRef.get(old.c.osmRef) : undefined;
  const resolution = resolveVenue(
    input.point,
    elements,
    old
      ? {
          ref: old.c.osmRef ?? null,
          tags: pickEl?.tags ?? {},
          at: old.c,
          sizeM2: pickEl?.area ? areaSizeM2(pickEl.area) : null,
        }
      : null
  );
  // Every candidate that stands inside a supported building is its alternative.
  const marked = base.map((c) => {
    const el = c.osmRef ? byRef.get(c.osmRef) : undefined;
    const parent = foldTarget(
      entityOf(el ?? { ref: c.osmRef ?? "", tags: {}, area: null, point: c }, c),
      elements
    );
    return parent && parent.ref !== c.osmRef ? { ...c, foldedInto: venueName(parent.tags) } : c;
  });
  if (!resolution.target) return { candidates: marked, probable: null, resolved: null };
  const target = resolution.target;
  const existing = marked.find((c) => c.osmRef === target.ref);
  const area = areaCandidate(target, input, existing, withPhotos);
  const rest = marked.filter((c) => c.osmRef !== target.ref);
  return {
    candidates: [area, ...rest],
    probable: {
      name: area.name,
      source: "nearbyPlace",
      photoSupported: (area.photoCount ?? 0) > 0,
    },
    resolved: resolution.reason,
  };
}

const stateOf = (degraded: boolean, empty: boolean): GeocoderState =>
  degraded ? "degraded" : empty ? "empty" : "ok";

export function combineStayIdentity(input: StayIdentityInput): StayIdentityView {
  const withPhotos = input.photos.state === "ok";
  const assets = withPhotos ? input.photos.assets : [];
  const cities = cityHints(assets);
  const found = candidatesOf({ ...input, photos: { ...input.photos, assets } }, withPhotos);
  const parts = input.geocode.parts;
  const venueState: VenueState = input.venues?.state ?? "off";
  const ranked = USABLE_VENUE_STATES.includes(venueState)
    ? rankWithVenues({ ...input, photos: { ...input.photos, assets } }, found, withPhotos)
    : { candidates: found, probable: null, resolved: null };
  const candidates = ranked.candidates;
  return {
    probable: ranked.probable ?? probableOf(candidates, parts, cities),
    address: parts
      ? {
          address: parts.address ?? null,
          city: parts.city ?? null,
          country: parts.country ?? null,
        }
      : null,
    geocoder: stateOf(input.geocode.degraded, parts === null),
    candidates,
    candidatesState: stateOf(input.places.degraded, input.places.results.length === 0),
    venues: { state: venueState, resolved: ranked.resolved },
    photos: {
      state: input.photos.state,
      count: assets.length,
      cities,
      truncated: withPhotos && input.photos.truncated,
    },
  };
}

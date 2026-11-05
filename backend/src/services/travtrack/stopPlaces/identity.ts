import { prisma } from "../../../db";
import { haversineKm } from "../../../shared/geo/haversine";
import {
  stayIdentityView,
  type IdentityShape,
  type StayIdentity,
} from "../../dawarich/stays/identity";
import { REVERSE_CANDIDATE_POOL } from "../../geo/photon";
import { readSuggestionSwitches } from "../../settings/suggestionSwitches";
import { rankStopCandidates, STOP_LOOKUP_RADIUS_KM } from "./candidateRanking";

/**
 * What a TravTrack stop probably was (spec 2026-11-03-travtrack-legs, "As
 * built — stop places"): the owner's own places and lodgings within
 * `KNOWN_PLACE_M` first, then the stay-identity lookup the Dawarich stay cards
 * use (nearest named place, address, photos), searched tight and nearest-first.
 * Asked per visible stop, never for the day; the lookup caches per stop.
 */

export const KNOWN_PLACE_M = 100;
// fetch = Photon's whole reverse pool: the geocoder's importance cut would otherwise drop
// an office (ranked low) before the stop's own ranking ever saw it.
const STOP_SHAPE: IdentityShape = {
  fetch: REVERSE_CANDIDATE_POOL,
  radiusKm: STOP_LOOKUP_RADIUS_KM,
  arrange: rankStopCandidates,
  name: "stop",
};

export type KnownPlace = {
  name: string;
  kind: "place" | "lodging";
  distanceM: number;
  lat: number;
  lon: number;
};

export type StopIdentity = Omit<StayIdentity, "probable" | "placeTypeAvailable"> & {
  probable: {
    name: string;
    source: "known" | "nearbyPlace" | "address" | "photos";
    photoSupported: boolean;
  } | null;
  /** The owner's own places and lodgings near the anchor, nearest first. */
  known: KnownPlace[];
  /**
   * `off`: the account's stay-suggestions switch is off, so only `known` was asked and no
   * geocoder, Immich or photo lookup ran. An older client that ignores it reads an empty answer.
   */
  lookup: "on" | "off";
};

const LAT_DEG = KNOWN_PLACE_M / 111_000;

async function knownNear(userId: string, at: { lat: number; lon: number }): Promise<KnownPlace[]> {
  // A degree of longitude shrinks with latitude; near a pole (or across the antimeridian)
  // the box is not worth narrowing: the haversine filter below decides.
  const cos = Math.cos((at.lat * Math.PI) / 180);
  const lonDeg = cos > 0.2 ? LAT_DEG / cos : 180;
  const box = {
    lat: { gte: at.lat - LAT_DEG, lte: at.lat + LAT_DEG },
    ...(lonDeg >= 180 || at.lon - lonDeg < -180 || at.lon + lonDeg > 180
      ? {}
      : { lon: { gte: at.lon - lonDeg, lte: at.lon + lonDeg } }),
  };
  const [places, lodgings] = await Promise.all([
    prisma.place.findMany({
      where: { userId, ...box },
      select: { name: true, lat: true, lon: true },
    }),
    prisma.lodging.findMany({
      where: { userId, ...box },
      select: { name: true, lat: true, lon: true },
    }),
  ]);
  return [
    ...places.map((p) => ({ ...p, kind: "place" as const })),
    ...lodgings.flatMap((l) =>
      l.lat === null || l.lon === null
        ? []
        : [{ name: l.name, lat: l.lat, lon: l.lon, kind: "lodging" as const }]
    ),
  ]
    .map((k) => ({ ...k, distanceM: Math.round(haversineKm(at, k) * 1000) }))
    .filter((k) => k.distanceM <= KNOWN_PLACE_M)
    .sort((a, b) => a.distanceM - b.distanceM);
}

export async function stopIdentityFor(
  userId: string,
  stop: { lat: number; lon: number; fromMs: number; untilMs: number }
): Promise<StopIdentity> {
  const switches = await readSuggestionSwitches(userId);
  if (!switches.staySuggestionsEnabled) {
    // The switch stops the WORK (forgejo#306): the owner's own rows are not a suggestion
    // engine and cost no outbound call, so they still answer; nothing else is asked.
    const known = await knownNear(userId, stop);
    return {
      lat: stop.lat,
      lon: stop.lon,
      probable: known[0] ? { name: known[0].name, source: "known", photoSupported: false } : null,
      address: null,
      geocoder: "empty",
      candidates: [],
      candidatesState: "empty",
      photos: { state: "off", count: 0, cities: [], truncated: false },
      known,
      lookup: "off",
    };
  }
  const [known, view] = await Promise.all([
    knownNear(userId, stop),
    stayIdentityView(
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
    ),
  ]);
  const probable: StopIdentity["probable"] = known[0]
    ? { name: known[0].name, source: "known", photoSupported: false }
    : view.probable;
  return { lat: stop.lat, lon: stop.lon, ...view, probable, known, lookup: "on" };
}

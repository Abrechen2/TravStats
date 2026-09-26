import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import type { DomainKey } from "../../shared/domains";
import { detectTrips } from "../tripDetectionService";
import { composeSuggestions, type FlightCluster } from "./compose";
import { loadTrips, readUserScope, resolveHome } from "./context";
import { loadAcceptedPhotoJourneys, loadPlaceVisits, loadRoutes, loadStays } from "./loadGround";
import { loadCruises, loadFlights, loadRail, type Loaded } from "./loadTransport";
import type { AnsweredProposal } from "./proposals";
import { todayIn } from "./time";
import type { HomeSource, PlaceContext, SuggestionKind, TripSuggestion } from "./types";

/**
 * The trip-suggestion engine (owner decision 2026-09-26): one presence timeline
 * across every domain the reader has, folded into proposals for the inbox.
 *
 * Computed on demand, never stored — see `TripSuggestionDecision` in the schema
 * for why only the ANSWERS are. The result is cached per user behind a stamp
 * of the tables it reads (row count and latest `updatedAt` of each, plus the
 * readable domains and today's date), so the inbox badge's 30-second poll costs
 * a dozen indexed aggregates instead of a full recompute, and any edit —
 * including one made on another device — invalidates it on the next read.
 */

export interface EngineResult {
  suggestions: TripSuggestion[];
  home: HomeSource;
  /** Some table held more rows than one pass reads; the list may be incomplete. */
  truncated: boolean;
}

/** Users whose result is held; the oldest is dropped past this. */
const CACHE_USERS = 200;
const cache = new Map<string, { stamp: string; result: EngineResult }>();

/** Forget one user's cached result — after an answer, the next read recomputes. */
export function invalidateTripSuggestions(userId: string): void {
  cache.delete(userId);
}

type StampRow = { part: string; n: bigint; latest: Date | null };

/**
 * One round trip, the statistics ETag's shape (`middleware/statsEtag.ts`): the
 * row count and newest `updated_at` of every table the engine reads. A count
 * catches a delete, the timestamp an insert or an edit.
 */
async function dataStamp(
  userId: string,
  domains: readonly DomainKey[],
  today: string
): Promise<string> {
  const rows = await prisma.$queryRaw<StampRow[]>(Prisma.sql`
    SELECT 'flights' AS part, count(*) AS n, max(updated_at) AS latest FROM flights WHERE user_id = ${userId}
    UNION ALL SELECT 'rail_journeys', count(*), max(updated_at) FROM rail_journeys WHERE user_id = ${userId}
    UNION ALL SELECT 'cruises', count(*), max(updated_at) FROM cruises WHERE user_id = ${userId}
    UNION ALL SELECT 'cruise_stops', count(*), max(s.updated_at) FROM cruise_stops s JOIN cruises c ON c.id = s.cruise_id WHERE c.user_id = ${userId}
    UNION ALL SELECT 'lodgings', count(*), max(updated_at) FROM lodgings WHERE user_id = ${userId}
    UNION ALL SELECT 'lodging_stays', count(*), max(updated_at) FROM lodging_stays WHERE user_id = ${userId}
    UNION ALL SELECT 'places', count(*), max(updated_at) FROM places WHERE user_id = ${userId}
    UNION ALL SELECT 'place_visits', count(*), max(updated_at) FROM place_visits WHERE user_id = ${userId}
    UNION ALL SELECT 'trips', count(*), max(updated_at) FROM trips WHERE user_id = ${userId}
    UNION ALL SELECT 'trip_routes', count(*), max(updated_at) FROM trip_routes WHERE user_id = ${userId}
    UNION ALL SELECT 'trip_stops', count(*), max(s.updated_at) FROM trip_stops s JOIN trip_routes r ON r.id = s.route_id WHERE r.user_id = ${userId}
    UNION ALL SELECT 'photo_journeys', count(*), max(updated_at) FROM photo_journeys WHERE user_id = ${userId}
    UNION ALL SELECT 'decisions', count(*), max(updated_at) FROM trip_suggestion_decisions WHERE user_id = ${userId}
    UNION ALL SELECT 'user_settings', count(*), max(updated_at) FROM user_settings WHERE user_id = ${userId}
  `);
  const parts = rows
    .map((r) => `${r.part}:${r.n.toString()}:${r.latest ? r.latest.getTime() : "-"}`)
    .sort();
  return [today, domains.join(","), ...parts].join("|");
}

const EMPTY: Loaded = { entries: [], truncated: false };

async function loadAnswered(userId: string): Promise<AnsweredProposal[]> {
  const rows = await prisma.tripSuggestionDecision.findMany({
    where: { userId },
    select: { kind: true, fingerprint: true, targetId: true, memberKeys: true },
  });
  return rows.map((r) => ({ ...r, kind: r.kind as SuggestionKind }));
}

/** The flight heuristics as signals — `POST /trips/detect` itself is unchanged. */
async function flightClusters(userId: string): Promise<FlightCluster[]> {
  const { proposed } = await detectTrips({ userId, dryRun: true });
  return proposed.map((p) => ({
    source: p.source,
    flightKeys: p.flightIds.map((id) => `flight:${id}`),
  }));
}

async function compute(
  userId: string,
  domains: readonly DomainKey[],
  today: string
): Promise<EngineResult> {
  const has = (key: DomainKey): boolean => domains.includes(key);
  const [flights, rail, cruises, stays, visits, routes, photos, trips, answered, clusters, home] =
    await Promise.all([
      has("flight") ? loadFlights(userId) : EMPTY,
      has("rail") ? loadRail(userId) : EMPTY,
      has("cruise") ? loadCruises(userId) : EMPTY,
      has("lodging") ? loadStays(userId) : EMPTY,
      has("poi") ? loadPlaceVisits(userId) : { ...EMPTY, places: [] as PlaceContext[] },
      has("roadtrip") ? loadRoutes(userId, today) : EMPTY,
      loadAcceptedPhotoJourneys(userId),
      loadTrips(userId),
      loadAnswered(userId),
      has("flight") ? flightClusters(userId) : Promise.resolve([]),
      resolveHome(userId),
    ]);
  const loaded = [flights, rail, cruises, stays, visits, routes, photos];
  const suggestions = composeSuggestions({
    entries: loaded.flatMap((l) => l.entries),
    trips,
    places: visits.places,
    homeAt: home.homeAt,
    homeKnown: home.source !== "missing",
    clusters,
    answered,
  });
  return { suggestions, home: home.source, truncated: loaded.some((l) => l.truncated) };
}

export async function computeTripSuggestions(userId: string): Promise<EngineResult> {
  const { domains, profileZone } = await readUserScope(userId);
  const today = todayIn(profileZone);
  const stamp = await dataStamp(userId, domains, today);
  const held = cache.get(userId);
  if (held && held.stamp === stamp) return held.result;

  const result = await compute(userId, domains, today);
  cache.delete(userId);
  cache.set(userId, { stamp, result });
  if (cache.size > CACHE_USERS) cache.delete(cache.keys().next().value as string);
  return result;
}

import { createHash } from "node:crypto";
import { prisma } from "../../../db";
import { now } from "../../../shared/time/clock";
import { getLocationProvider } from "../../locationProvider/provider";
import { travTrackInstanceOn } from "../../travtrack/availability";

/**
 * One read of a trip's track per change, not per request (TravTrack plan L5,
 * Codex review P2). Reading the track can mean a full remote Dawarich read of
 * the trip's window — up to 50 sequential pages — so:
 *
 *   - concurrent requests for the same track share the one read in flight;
 *   - a repeat within `TTL_MS` is answered from memory;
 *   - the key carries a stamp of everything that changes what the track may
 *     show — the provider and its revision, the trip's window, its flights,
 *     the own recording's batches, the newest TravTrack point and links, the
 *     history generation every removal raises, the privacy zones and their
 *     tombstones, the Dawarich connection — so any of those reads again at
 *     once. A privacy zone created a second ago is therefore never answered
 *     with a line cut before it existed.
 *
 * Dawarich's own new points are not visible to the stamp; the short TTL is
 * what bounds how stale those may be. A failed read is not kept. In memory,
 * per process: a restart forgets it, which costs one read.
 */

export const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type Entry<T> = { at: number; value: Promise<T> };
const entries = new Map<string, Entry<unknown>>();

type StampTrip = {
  id: string;
  startDay: Date | null;
  endDay: Date | null;
  startZone: string | null;
  endZone: string | null;
  updatedAt: Date;
};

/** What the track depends on, as one digest. Cheap aggregates, no point is read. */
async function stampOf(userId: string, trip: StampTrip): Promise<string> {
  const [
    provider,
    travTrackOn,
    batches,
    newest,
    links,
    state,
    zones,
    tombstones,
    flights,
    settings,
  ] = await Promise.all([
    getLocationProvider(userId),
    travTrackInstanceOn(),
    prisma.tripRecordingBatch.aggregate({
      where: { tripId: trip.id, userId },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.travTrackPoint.findFirst({
      where: { userId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    }),
    prisma.travTrackPointLink.count({
      where: { userId, entryKind: "trip", entryId: trip.id },
    }),
    prisma.travTrackDerivationState.findUnique({
      where: { userId },
      select: { historyGeneration: true },
    }),
    prisma.travTrackPrivacyZone.aggregate({
      where: { userId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.travTrackZoneTombstone.aggregate({
      where: { userId },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.flight.aggregate({
      where: { tripId: trip.id, userId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.userSettings.findUnique({ where: { userId }, select: { updatedAt: true } }),
  ]);
  const parts = [
    provider.kind,
    provider.rev,
    provider.status,
    travTrackOn,
    trip.startDay?.getTime(),
    trip.endDay?.getTime(),
    trip.startZone,
    trip.endZone,
    trip.updatedAt.getTime(),
    batches._count._all,
    batches._max.createdAt?.getTime(),
    newest?.seq.toString(),
    links,
    state?.historyGeneration.toString(),
    zones._count._all,
    zones._max.updatedAt?.getTime(),
    tombstones._count._all,
    tombstones._max.createdAt?.getTime(),
    flights._count._all,
    flights._max.updatedAt?.getTime(),
    settings?.updatedAt.getTime(),
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Drops every entry past its TTL, then the oldest beyond the cap. */
function prune(at: number): void {
  for (const [key, entry] of entries) if (at - entry.at >= TTL_MS) entries.delete(key);
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

/** `read()` once per user, trip and stamp within the TTL; concurrent callers share it. */
export async function cachedTrack<T>(
  userId: string,
  trip: StampTrip,
  read: () => Promise<T>
): Promise<T> {
  const prefix = `${userId}:${trip.id}:`;
  const key = prefix + (await stampOf(userId, trip));
  const at = now().getTime();
  prune(at);
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit) return hit.value;
  // An older stamp of the same track is superseded: it can never be served again.
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
  const value = read();
  entries.set(key, { at, value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** For tests. */
export function clearTrackCache(): void {
  entries.clear();
}

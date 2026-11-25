import { addWriteObserver, type WriteEvent } from "../../db";

/**
 * The gap calendar's cache: per `userId|year|zone`, in process. An entry is
 * dropped when a source model of that user is written, and expires on its own
 * after `TTL_MS` — a write that goes around the Prisma client (the raw-SQL
 * fix ingest) is not observed, so the clock bounds how stale a day can be.
 * A write whose user cannot be read from its arguments drops everything: a
 * stale calendar is worse than a rebuilt one.
 */

export const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const POST_COMMIT_DROP_MS = 1_000;

/** The models whose rows decide a day's state (Prisma model names). */
export const SOURCE_MODELS: ReadonlySet<string> = new Set([
  "Trip",
  "Cruise",
  "LodgingStay",
  "Flight",
  "RailJourney",
  "BusJourney",
  "FerryJourney",
  "RentalBooking",
  "PlaceVisit",
  "TravTrackPoint",
  "TravTrackPrivacyZone",
  "TravTrackZoneTombstone",
  "TravTrackPlaceSettings",
  "UserSettings",
]);

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

interface Entry {
  at: number;
  value: unknown;
}

const entries = new Map<string, Entry>();
const pending = new Set<ReturnType<typeof setTimeout>>();

/**
 * Raised by every invalidation. A read remembers it before it queries and may
 * only store its answer if it has not moved: otherwise a write that landed
 * mid-read would be overwritten by the older answer for the whole TTL.
 */
let generation = 0;

export const currentGeneration = (): number => generation;

const keyOf = (userId: string, year: number, zone: string) => `${userId}|${year}|${zone}`;

export function cacheGet<T>(userId: string, year: number, zone: string, nowMs: number): T | null {
  const key = keyOf(userId, year, zone);
  const hit = entries.get(key);
  if (!hit) return null;
  if (nowMs - hit.at > TTL_MS) {
    entries.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cachePut(
  userId: string,
  year: number,
  zone: string,
  value: unknown,
  nowMs: number,
  readGeneration: number
): void {
  if (readGeneration !== generation) return;
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(keyOf(userId, year, zone), { at: nowMs, value });
}

export function invalidateUser(userId: string): void {
  generation += 1;
  for (const key of entries.keys()) if (key.startsWith(`${userId}|`)) entries.delete(key);
}

export function clearGapCalendarCache(): void {
  generation += 1;
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  entries.clear();
}

/** The user a write names in its arguments or result, or null when it names none. */
export function userOf(event: WriteEvent): string | null {
  const args = event.args as {
    where?: { userId?: unknown };
    data?: { userId?: unknown } | Array<{ userId?: unknown }>;
    create?: { userId?: unknown };
  } | null;
  const candidates: unknown[] = [
    args?.where?.userId,
    args?.create?.userId,
    Array.isArray(args?.data) ? null : (args?.data as { userId?: unknown } | undefined)?.userId,
    (event.result as { userId?: unknown } | null)?.userId,
  ];
  const found = candidates.find((c): c is string => typeof c === "string");
  if (Array.isArray(args?.data)) {
    const users = new Set(args.data.map((d) => d.userId));
    if (users.size === 1) {
      const [only] = users;
      return typeof only === "string" ? only : null;
    }
    return null;
  }
  return found ?? null;
}

export function onWrite(event: WriteEvent): void {
  if (!event.model || !SOURCE_MODELS.has(event.model) || !WRITE_OPERATIONS.has(event.operation)) {
    return;
  }
  const user = userOf(event);
  const drop = () => (user ? invalidateUser(user) : clearGapCalendarCache());
  drop();
  // The observer runs inside the query, before an enclosing transaction commits: a read
  // between now and the commit would store pre-commit facts, so drop once more shortly after.
  const timer = setTimeout(() => {
    pending.delete(timer);
    drop();
  }, POST_COMMIT_DROP_MS);
  timer.unref();
  pending.add(timer);
}

let stop: (() => void) | null = null;

/** Idempotent: called when the service is first used. */
export function ensureCacheInvalidation(): void {
  if (!stop) stop = addWriteObserver(onWrite);
}

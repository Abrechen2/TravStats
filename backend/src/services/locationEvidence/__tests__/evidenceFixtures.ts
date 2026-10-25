import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import type { CachedCatalog } from "../../dawarich/marketVisits/catalog";
import type { MarketCatalog } from "../../dawarich/marketVisits/osm";
import { makeUser, storePoint } from "../../travtrack/__tests__/fixtures";
import { takeTravTrackLock } from "../../travtrack/lock";
import type { DbTransaction } from "../../../db";

/**
 * Accounts, stops and locks for the TravTrack acceptance suites (plan E4).
 * Not a test file (no `.test.ts` suffix).
 */

export const MIN = 60_000;
export const SEOUL = { lat: 37.57, lon: 126.97 };
/** 19:00 in Seoul. */
export const BASE = Date.parse("2026-10-10T10:00:00Z");
export const NOW = new Date("2026-10-11T06:00:00Z");

export async function evidenceAccount(
  username: string,
  provider: "travtrack" | "none" = "travtrack",
  ownDawarich = false
): Promise<string> {
  const id = await makeUser(username);
  await prisma.userSettings.create({
    data: {
      userId: id,
      data: {},
      enabledDomains: ["poi"],
      locationProvider: provider,
      ...(ownDawarich
        ? {
            dawarichBaseUrl: "http://dawarich.local:3000",
            dawarichApiKey: encryptApiKey("own-key"),
          }
        : {}),
    },
  });
  await prisma.dawarichStayScan.create({ data: { userId: id, enabled: true } });
  return id;
}

/** Points every `stepMin` minutes at the given minutes after BASE. */
export async function storeMinutes(
  userId: string,
  minutes: number[],
  where: { lat: number; lon: number } = SEOUL
): Promise<void> {
  for (const m of minutes) await storePoint(userId, { t: BASE + m * MIN, ...where });
}

export const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** The stay review a person sends for a stop at BASE in Seoul lasting `minutes`. */
export function seoulReview(minutes = 30) {
  const local = (m: number) => {
    const at = new Date(BASE + m * MIN + 9 * 3_600_000).toISOString();
    return at.slice(0, 16);
  };
  return {
    name: "Seoul stop",
    placeId: null,
    tripId: null,
    lat: SEOUL.lat,
    lon: SEOUL.lon,
    startAt: { local: local(0) },
    endAt: { local: local(minutes) },
  };
}

export const marketRaw = {
  elements: [
    {
      type: "way",
      id: 4321,
      tags: { amenity: "marketplace", name: "Evidence Market", wikidata: "Q4321" },
      geometry: [
        { lat: 37.569, lon: 126.969 },
        { lat: 37.571, lon: 126.969 },
        { lat: 37.571, lon: 126.971 },
        { lat: 37.569, lon: 126.971 },
        { lat: 37.569, lon: 126.969 },
      ],
    },
  ],
};

export function memoryStore() {
  const cache = new Map<string, CachedCatalog>();
  return {
    read: async (key: string) => cache.get(key) ?? null,
    write: async (key: string, payload: MarketCatalog, fetchedAt: Date) => {
      cache.set(key, { payload, fetchedAt });
    },
    claim: async (at: Date) => at,
    complete: async () => {},
  };
}

/**
 * Holds the account's TravTrack lock in another transaction. `release(work)`
 * runs `work` inside that transaction — still holding the lock — and commits.
 */
export async function holdTravTrackLock(userId: string) {
  let go!: (work: (tx: DbTransaction) => Promise<void>) => void;
  let held!: () => void;
  const released = new Promise<(tx: DbTransaction) => Promise<void>>((resolve) => (go = resolve));
  const isHeld = new Promise<void>((resolve) => (held = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      held();
      const work = await released;
      await work(tx);
    },
    { timeout: 30_000 }
  );
  await isHeld;
  return async (work: (tx: DbTransaction) => Promise<void> = async () => {}) => {
    go(work);
    await done;
  };
}

/** Until some transaction waits for an advisory lock. */
export async function untilSomeoneWaitsForTheLock(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    if (n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("nobody waited for the lock");
}

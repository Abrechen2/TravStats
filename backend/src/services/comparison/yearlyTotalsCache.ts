/**
 * Cache of the yearly-totals build (it runs every domain loader once per year, so a lifetime
 * pull from a v3 peer is the heaviest thing the leaderboard does). In process, per user and
 * scope:
 *  - an entry is dropped when a counted model of that user is written (the same Prisma write
 *    observer the gap calendar uses), and expires on its own after `TTL_MS` because a write that
 *    goes around the client (raw SQL ingest) is not observed;
 *  - builds are serialised per user and coalesced per scope: two pulls that arrive together
 *    share one build, and one user never has two builds running at once;
 *  - a build that a write overtook is returned to its callers but not stored.
 */
import { addWriteObserver, type WriteEvent } from "../../db";
import { SOURCE_MODELS, userOf } from "../gapCalendar/cache";
import type { YearlyTotals } from "./yearlyTotals";

export const TTL_MS = 6 * 60 * 60_000;
const MAX_ENTRIES = 200;
const POST_COMMIT_DROP_MS = 1_000;

/** The gap calendar's source models plus the ones only the totals read. */
const COUNTED_MODELS: ReadonlySet<string> = new Set([...SOURCE_MODELS, "Place", "TripRoute"]);
const WRITES: ReadonlySet<string> = new Set([
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

type Built = YearlyTotals | undefined;
const entries = new Map<string, { at: number; value: Built }>();
const inflight = new Map<string, Promise<Built>>();
const tails = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();
const timers = new Set<ReturnType<typeof setTimeout>>();

const keyOf = (userId: string, scopeKey: string): string => `${userId}|${scopeKey}`;
const genOf = (userId: string): number => generation.get(userId) ?? 0;

export function invalidateYearlyTotals(userId: string): void {
  generation.set(userId, genOf(userId) + 1);
  for (const key of entries.keys()) if (key.startsWith(`${userId}|`)) entries.delete(key);
}

export function clearYearlyTotalsCache(): void {
  for (const user of new Set([...entries.keys()].map((k) => k.split("|")[0])))
    invalidateYearlyTotals(user);
  entries.clear();
  for (const t of timers) clearTimeout(t);
  timers.clear();
}

function onWrite(event: WriteEvent): void {
  if (!event.model || !COUNTED_MODELS.has(event.model) || !WRITES.has(event.operation)) return;
  const user = userOf(event);
  // A write whose user cannot be read drops everything: a stale total is worse than a rebuild.
  const drop = (): void => (user ? invalidateYearlyTotals(user) : clearYearlyTotalsCache());
  drop();
  // The observer runs inside the query, before an enclosing transaction commits.
  const timer = setTimeout(() => {
    timers.delete(timer);
    drop();
  }, POST_COMMIT_DROP_MS);
  timer.unref();
  timers.add(timer);
}

let stop: (() => void) | null = null;

export async function cachedYearlyTotals(
  userId: string,
  scopeKey: string,
  build: () => Promise<Built>,
  nowMs: number = Date.now()
): Promise<Built> {
  if (!stop) stop = addWriteObserver(onWrite);
  const key = keyOf(userId, scopeKey);
  const hit = entries.get(key);
  if (hit && nowMs - hit.at <= TTL_MS) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const startedAt = genOf(userId);
  // One build per user at a time, whatever the scope: queue behind the previous one.
  const after = tails.get(userId) ?? Promise.resolve();
  const run = after
    .catch(() => undefined)
    .then(async () => {
      const value = await build();
      if (genOf(userId) === startedAt) {
        if (entries.size >= MAX_ENTRIES) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
        entries.set(key, { at: nowMs, value });
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
      if (tails.get(userId) === run) tails.delete(userId);
    });
  inflight.set(key, run);
  tails.set(userId, run);
  return run;
}

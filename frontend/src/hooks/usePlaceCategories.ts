import { useCallback, useEffect, useState } from "react";
import { listPlaceCategories, type CustomPlaceCategory } from "../lib/api/placeCategories";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";

/**
 * The user's own place categories, shared by every component that draws a
 * place: one request, then every hook instance reads the same list and is told
 * when the manager changes it. The cache belongs to ONE account — a sign-in as
 * someone else on the same tab must not show the previous user's categories.
 */
let cache: CustomPlaceCategory[] | null = null;
let cacheOwner: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(rows: CustomPlaceCategory[]) => void>();

async function fetchInto(userId: string | null): Promise<void> {
  const rows = await listPlaceCategories();
  cache = rows;
  cacheOwner = userId;
  listeners.forEach((fn) => fn(rows));
}

/** A forced reload waits for a request already under way and then asks again, so a
 *  change made after that request left is never missed; it throws, so the caller
 *  can say the list is stale instead of reporting a success it cannot show. */
async function load(force: boolean): Promise<void> {
  const userId = useAuthStore.getState().user?.id ?? null;
  if (cacheOwner !== userId) {
    cache = null;
    listeners.forEach((fn) => fn([]));
  }
  if (!force && cache) return;
  if (force && inflight) await inflight.catch(() => undefined);
  if (!force && inflight) return inflight;
  const run = fetchInto(userId).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  if (force) return run;
  // An unloadable list degrades to built-in glyphs; it must not break a place page.
  return run.catch((err: unknown) => logger.warn("usePlaceCategories: load failed", err));
}

/** Drop the cache — a test starts from nothing. */
export function resetPlaceCategoriesCache(): void {
  cache = null;
  cacheOwner = null;
  inflight = null;
}

export function usePlaceCategories(): {
  customs: CustomPlaceCategory[];
  reload: () => Promise<void>;
} {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [customs, setCustoms] = useState<CustomPlaceCategory[]>(
    cache && cacheOwner === userId ? cache : []
  );
  useEffect(() => {
    listeners.add(setCustoms);
    void load(false);
    if (cache && cacheOwner === userId) setCustoms(cache);
    return () => {
      listeners.delete(setCustoms);
    };
  }, [userId]);
  const reload = useCallback(() => load(true), []);
  return { customs, reload };
}

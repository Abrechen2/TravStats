import { useCallback, useEffect, useState } from "react";
import { listPlaceCategories, type CustomPlaceCategory } from "../lib/api/placeCategories";
import { logger } from "../lib/logger";

/**
 * The user's own place categories, shared by every component that draws a
 * place: one request, then every hook instance reads the same list and is told
 * when the settings page changes it.
 */
let cache: CustomPlaceCategory[] | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(rows: CustomPlaceCategory[]) => void>();

async function load(force: boolean): Promise<void> {
  if (!force && cache) return;
  if (!inflight) {
    inflight = listPlaceCategories()
      .then((rows) => {
        cache = rows;
        listeners.forEach((fn) => fn(rows));
      })
      .catch((err: unknown) => {
        // An unloadable list degrades to built-in glyphs; it must not break a place page.
        logger.warn("usePlaceCategories: load failed", err);
      })
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
}

/** Drop the cache — a test, or a sign-out, starts from nothing. */
export function resetPlaceCategoriesCache(): void {
  cache = null;
  inflight = null;
}

export function usePlaceCategories(): {
  customs: CustomPlaceCategory[];
  reload: () => Promise<void>;
} {
  const [customs, setCustoms] = useState<CustomPlaceCategory[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setCustoms);
    void load(false);
    if (cache) setCustoms(cache);
    return () => {
      listeners.delete(setCustoms);
    };
  }, []);
  const reload = useCallback(() => load(true), []);
  return { customs, reload };
}

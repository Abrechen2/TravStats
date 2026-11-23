import { useEffect, useMemo, useState } from "react";
import { getCuratedProgress } from "../lib/api/placeLists";
import { listNewOutlets, type SmartSuggestion } from "../lib/api/smartLists";
import { logger } from "../lib/logger";
import { buildListedPlaces, type ListSelectionKey } from "../lib/mapPlaceLists";
import { usePlaceListFilterStore } from "../store/placeListFilterStore";
import type { Place } from "../types/place";
import type { CuratedProgress, PlaceList } from "../types/placeList";
import { useTranslation } from "./useTranslation";

export interface ListedPlaces {
  /** What the map draws: every place with no list chosen, else the lists' members and ghosts. */
  drawn: readonly Place[];
  /** A list is narrowing the map (and unvisited members draw grey). */
  active: boolean;
  /** A chosen list's checklist or outlets could not be loaded — the map says so instead of silently drawing less. */
  failed: boolean;
}

const EMPTY_CURATED: ReadonlyMap<string, CuratedProgress> = new Map();
const EMPTY_OUTLETS: ReadonlyMap<string, readonly SmartSuggestion[]> = new Map();

/**
 * Narrows the dashboard map's places to the chosen lists. The members come from
 * the data the tab already holds; only what the tab cannot know is fetched —
 * the not-yet-ticked targets of a checklist and the new outlets of a smart
 * list, both shown grey.
 */
export function useListedPlaces(
  places: readonly Place[],
  lists: readonly PlaceList[],
  enabled: boolean
): ListedPlaces {
  const { i18n } = useTranslation();
  const selection = usePlaceListFilterStore((s) => s.selection);
  const [curated, setCurated] = useState<ReadonlyMap<string, CuratedProgress>>(EMPTY_CURATED);
  const [outlets, setOutlets] =
    useState<ReadonlyMap<string, readonly SmartSuggestion[]>>(EMPTY_OUTLETS);
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(new Set());

  // A stored selection may name a list that was deleted since: it must not blank the map.
  const knownLists = useMemo(() => new Set(lists.map((l) => l.id)), [lists]);
  const effective = useMemo<ListSelectionKey[]>(
    () =>
      selection.filter((k) =>
        k.startsWith("list:") ? knownLists.has(k.slice(5)) : !failedKeys.has(k)
      ),
    [selection, knownLists, failedKeys]
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const wantedCurated = selection
      .filter((k) => k.startsWith("curated:"))
      .map((k) => k.slice("curated:".length));
    const wantedOutlets = selection
      .filter((k) => k.startsWith("list:"))
      .map((k) => k.slice("list:".length))
      .filter((id) => knownLists.has(id));

    // Nothing to fetch: leave the state alone (no render, no stale request).
    if (wantedCurated.length === 0 && wantedOutlets.length === 0) return;

    void (async (): Promise<void> => {
      const failed = new Set<string>();
      const nextCurated = new Map<string, CuratedProgress>();
      const nextOutlets = new Map<string, readonly SmartSuggestion[]>();
      await Promise.all([
        ...wantedCurated.map(async (key) => {
          try {
            nextCurated.set(key, await getCuratedProgress(key));
          } catch (err: unknown) {
            logger.error(`useListedPlaces: checklist ${key} failed`, err);
            failed.add(`curated:${key}`);
          }
        }),
        ...wantedOutlets.map(async (id) => {
          try {
            nextOutlets.set(id, await listNewOutlets(id));
          } catch (err: unknown) {
            // The list's own members still draw; only the not-yet-visited outlets are missing.
            logger.error(`useListedPlaces: outlets of list ${id} failed`, err);
            failed.add(`outlets:${id}`);
          }
        }),
      ]);
      if (cancelled) return;
      setCurated(nextCurated);
      setOutlets(nextOutlets);
      setFailedKeys(failed);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, selection, knownLists]);

  const english = i18n.language.startsWith("en");
  const drawn = useMemo<readonly Place[]>(() => {
    if (effective.length === 0) return places;
    return buildListedPlaces({ selection: effective, places, lists, curated, outlets, english });
  }, [effective, places, lists, curated, outlets, english]);

  const active = enabled && effective.length > 0;
  const setViewActive = usePlaceListFilterStore((s) => s.setViewActive);
  useEffect(() => {
    setViewActive(active);
    return () => setViewActive(false);
  }, [active, setViewActive]);

  return {
    drawn,
    active,
    failed: failedKeys.size > 0,
  };
}

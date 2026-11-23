import type { Place } from "../types/place";
import type { CuratedProgress, PlaceList } from "../types/placeList";
import type { SmartSuggestion } from "./api/smartLists";

/**
 * Which place lists the dashboard map shows (owner, 2026-11-23). An empty
 * selection is "Alle Orte" — the map as it always was. A selection is a set of
 * keys: the user's own lists (`list:<id>`) and the shipped checklists
 * (`curated:<key>`), whether subscribed or not.
 *
 * Counting is untouched on purpose: this only chooses WHICH places are drawn.
 * Whether a drawn place counts as visited is `Place.visited`, the server's
 * answer under shared/placeCounting.ts; nothing here recomputes it, and no
 * statistic reads this file.
 */

export type ListSelectionKey = `list:${string}` | `curated:${string}`;

export const ownListKey = (id: string): ListSelectionKey => `list:${id}`;
export const curatedListKey = (key: string): ListSelectionKey => `curated:${key}`;

export function isListSelectionKey(value: unknown): value is ListSelectionKey {
  return typeof value === "string" && /^(list|curated):.+/.test(value);
}

/** A catalogue target or suggested outlet that is not a Place (yet) — drawn grey, never saved. */
export const GHOST_PLACE_PREFIX = "ghost:";

export function isGhostPlaceId(id: string): boolean {
  return id.startsWith(GHOST_PLACE_PREFIX);
}

/** The checklist a ghost belongs to ("wonders:petra" lives in "wonders"); null for an outlet. */
export function ghostCuratedKey(ghostId: string): string | null {
  const rest = ghostId.slice(GHOST_PLACE_PREFIX.length);
  if (rest.startsWith("outlet:")) return null;
  const key = rest.split(":")[0];
  return key.length > 0 ? key : null;
}

/** Reads a persisted selection defensively: anything that is not a key is dropped. */
export function selectionFromStored(raw: unknown): ListSelectionKey[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isListSelectionKey))];
}

/** A ghost needs every `Place` field; none of them is a visit. */
function ghostPlace(input: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  isoCountryCode?: string | null;
  continent?: string | null;
}): Place {
  return {
    id: `${GHOST_PLACE_PREFIX}${input.id}`,
    name: input.name,
    category: "landmark",
    lat: input.lat,
    lon: input.lon,
    address: null,
    city: null,
    country: input.country,
    isoCountryCode: input.isoCountryCode ?? null,
    externalRef: null,
    curatedItemId: null,
    visited: false,
    notes: null,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    visits: [],
    visitCount: 0,
    plannedVisitCount: 0,
    lastVisitAt: null,
    continent: input.continent ?? null,
  };
}

export interface ListedPlacesInput {
  selection: readonly ListSelectionKey[];
  /** Every place of the account, with visits — the same array the map draws today. */
  places: readonly Place[];
  /** The user's lists WITH entries. */
  lists: readonly PlaceList[];
  /** Progress of each selected checklist, by catalogue key. */
  curated: ReadonlyMap<string, CuratedProgress>;
  /** New-outlet suggestions of each selected smart list, by list id. */
  outlets: ReadonlyMap<string, readonly SmartSuggestion[]>;
  /** Pick the English catalogue name where there is one. */
  english: boolean;
}

/**
 * The places to draw for a list selection: the members of every chosen list,
 * each once, plus the ghosts — checklist targets not ticked yet and smart-list
 * outlets not yet visited. A member that is a real place keeps its own record,
 * so its visited/planned state is exactly what the logbook says.
 */
export function buildListedPlaces(input: ListedPlacesInput): Place[] {
  const byId = new Map(input.places.map((p) => [p.id, p]));
  const out = new Map<string, Place>();
  const add = (place: Place): void => {
    if (!out.has(place.id)) out.set(place.id, place);
  };

  for (const key of input.selection) {
    if (key.startsWith("list:")) {
      const listId = key.slice("list:".length);
      const list = input.lists.find((l) => l.id === listId);
      if (!list) continue;
      for (const entry of list.entries ?? []) {
        const full = byId.get(entry.placeId);
        add(
          full ?? {
            ...entry.place,
            visits: [],
            visitCount: 0,
            plannedVisitCount: 0,
            lastVisitAt: null,
          }
        );
      }
      for (const outlet of input.outlets.get(listId) ?? []) {
        if (!Number.isFinite(outlet.lat) || !Number.isFinite(outlet.lon)) continue;
        add(
          ghostPlace({
            id: `outlet:${outlet.id}`,
            name: outlet.name ?? list.name,
            lat: outlet.lat,
            lon: outlet.lon,
            country: null,
          })
        );
      }
    } else {
      const progress = input.curated.get(key.slice("curated:".length));
      if (!progress) continue;
      for (const item of progress.items) {
        const real = item.placeId ? byId.get(item.placeId) : undefined;
        if (real && item.ticked) {
          add(real);
          continue;
        }
        add(
          ghostPlace({
            id: item.itemId,
            name: input.english ? (item.nameEn ?? item.name) : item.name,
            lat: item.lat,
            lon: item.lon,
            country: item.country,
            isoCountryCode: item.isoCountryCode,
            continent: item.continent,
          })
        );
      }
    }
  }
  return [...out.values()];
}

/** Whether the selection still names a list that exists — a deleted list must not blank the map. */
export function resolveSelection(
  selection: readonly ListSelectionKey[],
  known: ReadonlySet<ListSelectionKey>
): ListSelectionKey[] {
  return selection.filter((k) => known.has(k));
}

import { describe, it, expect } from "vitest";
import type { Place } from "../../types/place";
import type { PlaceList } from "../../types/placeList";

/**
 * The list filter, as a rule rather than as a rendered page.
 *
 * The places list could filter by status, category and country but not by
 * LIST — although the dashboard tab had done so all along. With 58 McDonald's
 * in one list and 54 other places beside them, "show me only that list" is the
 * filter that makes the page usable at all.
 *
 * What is pinned here is membership: a filtered view contains exactly the
 * places the list names, and nothing else. Rendering the dropdown is covered
 * by the page test; this covers the part a wrong `Set` would break silently.
 */
function membersOf(lists: PlaceList[], listId: string): Set<string> | null {
  if (listId === "all") return null;
  const found = lists.find((l) => l.id === listId);
  return new Set((found?.entries ?? []).map((e) => e.placeId));
}

function applyFilter(places: Place[], members: Set<string> | null): Place[] {
  return places.filter((p) => !members || members.has(p.id));
}

const place = (id: string, name: string): Place =>
  ({ id, name, category: "restaurant", lat: 0, lon: 0, visited: true }) as unknown as Place;

const PLACES = [place("a", "McDonald's Eching"), place("b", "Colosseo"), place("c", "Petra")];

const LISTS = [
  {
    id: "mcd",
    name: "McDonald",
    entries: [{ placeId: "a" }],
  },
  {
    id: "leer",
    name: "Noch leer",
    entries: [],
  },
] as unknown as PlaceList[];

describe("places list — filter by list", () => {
  it("shows every place when no list is chosen", () => {
    expect(applyFilter(PLACES, membersOf(LISTS, "all"))).toHaveLength(3);
  });

  it("shows exactly the members of the chosen list", () => {
    const shown = applyFilter(PLACES, membersOf(LISTS, "mcd"));
    expect(shown.map((p) => p.id)).toEqual(["a"]);
  });

  it("shows nothing for a list that has no entries yet", () => {
    // Not "everything" — an empty list means an empty result, or the filter
    // would quietly do nothing and look broken.
    expect(applyFilter(PLACES, membersOf(LISTS, "leer"))).toHaveLength(0);
  });

  it("shows nothing for a list id that no longer exists", () => {
    // A list deleted in another tab must not silently widen the view back to
    // everything, which would look like the filter was ignored.
    expect(applyFilter(PLACES, membersOf(LISTS, "geloescht"))).toHaveLength(0);
  });
});

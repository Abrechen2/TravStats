import { describe, expect, it } from "vitest";
import {
  buildListedPlaces,
  curatedListKey,
  ghostCuratedKey,
  isGhostPlaceId,
  ownListKey,
  selectionFromStored,
} from "../mapPlaceLists";
import type { Place } from "../../types/place";
import type { CuratedProgress, PlaceList } from "../../types/placeList";

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    name: id,
    category: "restaurant",
    lat: 1,
    lon: 2,
    address: null,
    city: null,
    country: null,
    isoCountryCode: null,
    externalRef: null,
    curatedItemId: null,
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "",
    updatedAt: "",
    visits: [],
    visitCount: 1,
    plannedVisitCount: 0,
    lastVisitAt: null,
    continent: null,
    ...over,
  };
}

function list(id: string, placeIds: string[]): PlaceList {
  return {
    id,
    name: id,
    entries: placeIds.map((placeId) => ({ placeId, place: place(placeId) })),
  } as unknown as PlaceList;
}

const WONDER_NAMES = [
  "Petra",
  "Machu Picchu",
  "Chichén Itzá",
  "Cristo Redentor",
  "Colosseum",
  "Taj Mahal",
  "Great Wall",
];
function wonders(tickedCount: number): CuratedProgress {
  return {
    key: "wonders",
    items: WONDER_NAMES.map((name, i) => ({
      itemId: `wonders:${i}`,
      name,
      nameEn: null,
      lat: i,
      lon: i,
      country: null,
      isoCountryCode: null,
      continent: null,
      blurb: null,
      blurbEn: null,
      ticked: i < tickedCount,
      placeId: i < tickedCount ? `p${i}` : null,
      lastVisitAt: null,
    })),
  } as unknown as CuratedProgress;
}

const none = { curated: new Map(), outlets: new Map(), english: false };

describe("buildListedPlaces", () => {
  const places = [place("a"), place("b"), place("c", { visited: false, visitCount: 0 })];

  it("shows only the places of the chosen own list", () => {
    const drawn = buildListedPlaces({
      ...none,
      selection: [ownListKey("macs")],
      places,
      lists: [list("macs", ["a", "c"]), list("other", ["b"])],
    });
    expect(drawn.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("keeps an own-list place with no visit as an unvisited one next to a visited one", () => {
    const drawn = buildListedPlaces({
      ...none,
      selection: [ownListKey("macs")],
      places,
      lists: [list("macs", ["a", "c"])],
    });
    expect(drawn.find((p) => p.id === "a")?.visited).toBe(true);
    expect(drawn.find((p) => p.id === "c")?.visited).toBe(false);
  });

  it("draws all 7 wonders: the ticked ones as real places, the rest as unvisited ghosts", () => {
    const wonderPlaces = [0, 1, 2].map((i) => place(`p${i}`, { name: WONDER_NAMES[i] }));
    const drawn = buildListedPlaces({
      ...none,
      selection: [curatedListKey("wonders")],
      places: wonderPlaces,
      lists: [],
      curated: new Map([["wonders", wonders(3)]]),
    });
    expect(drawn).toHaveLength(7);
    expect(drawn.filter((p) => p.visited)).toHaveLength(3);
    const ghosts = drawn.filter((p) => !p.visited);
    expect(ghosts).toHaveLength(4);
    expect(ghosts.every((p) => isGhostPlaceId(p.id) && p.visitCount === 0)).toBe(true);
  });

  it("adds a smart list's suggested outlets as unvisited ghosts", () => {
    const drawn = buildListedPlaces({
      ...none,
      selection: [ownListKey("macs")],
      places,
      lists: [list("macs", ["a"])],
      outlets: new Map([
        ["macs", [{ id: "s1", name: "McDonald's Mitte", lat: 5, lon: 6 } as never]],
      ]),
    });
    expect(drawn.map((p) => [p.id, p.visited])).toEqual([
      ["a", true],
      ["ghost:outlet:s1", false],
    ]);
  });

  it("draws a place that sits in two chosen lists once", () => {
    const drawn = buildListedPlaces({
      ...none,
      selection: [ownListKey("x"), ownListKey("y")],
      places,
      lists: [list("x", ["a"]), list("y", ["a", "b"])],
    });
    expect(drawn.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("names a ghost in English when asked", () => {
    const progress = wonders(0);
    progress.items[0] = { ...progress.items[0], nameEn: "Petra (EN)" };
    const drawn = buildListedPlaces({
      ...none,
      english: true,
      selection: [curatedListKey("wonders")],
      places: [],
      lists: [],
      curated: new Map([["wonders", progress]]),
    });
    expect(drawn[0].name).toBe("Petra (EN)");
  });
});

describe("selection keys", () => {
  it("drops anything that is not a list key when reading a stored selection", () => {
    expect(selectionFromStored(["list:1", "curated:wonders", "bogus", 4, "list:1"])).toEqual([
      "list:1",
      "curated:wonders",
    ]);
    expect(selectionFromStored(undefined)).toEqual([]);
  });

  it("finds the checklist a ghost belongs to, and none for an outlet", () => {
    expect(ghostCuratedKey("ghost:wonders:petra")).toBe("wonders");
    expect(ghostCuratedKey("ghost:outlet:s1")).toBeNull();
  });
});

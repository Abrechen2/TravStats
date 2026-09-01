import { describe, it, expect } from "vitest";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  DEFAULT_PLACE_COLORS,
  buildPlaceLegend,
  resolvePlaceColor,
  resolvePlaceListColors,
  slotsForPlaceMode,
  type PlaceColorConfig,
} from "../placeColor";

const listMode: PlaceColorConfig = { ...DEFAULT_PLACE_COLOR_CONFIG, mode: "list" };

const maccis = {
  id: "l1",
  name: "Maccis weltweit",
  color: "#e3b341",
  entries: [{ placeId: "trevi" }, { placeId: "shibuya" }],
};
const rom = {
  id: "l2",
  name: "Rom",
  color: "#8957e5",
  // The Trevi McDonald's is in BOTH lists — the case the membership table
  // exists for, and the one a pin colour has to resolve.
  entries: [{ placeId: "trevi" }, { placeId: "kolosseum" }],
};

describe("resolvePlaceListColors", () => {
  it("gives a place in one list that list's colour", () => {
    const { byPlaceId } = resolvePlaceListColors([maccis]);
    expect(byPlaceId.get("shibuya")).toEqual([227, 179, 65]);
  });

  it("lets the FIRST list win when a place is in several", () => {
    // Lists arrive sorted by sortIdx then name, so the winner is the one the
    // user ordered first — a rule they can change, not one hidden in a layer.
    const first = resolvePlaceListColors([maccis, rom]);
    expect(first.byPlaceId.get("trevi")).toEqual([227, 179, 65]);

    const other = resolvePlaceListColors([rom, maccis]);
    expect(other.byPlaceId.get("trevi")).toEqual([137, 87, 229]);
  });

  it("leaves a place in no list absent rather than guessing a colour", () => {
    const { byPlaceId } = resolvePlaceListColors([maccis]);
    expect(byPlaceId.has("kolosseum")).toBe(false);
  });

  it("reports only the lists that actually colour a pin", () => {
    const empty = { id: "l3", name: "Leer", color: "#3fb950", entries: [] };
    const { used } = resolvePlaceListColors([maccis, empty]);
    expect(used.map((l) => l.id)).toEqual(["l1"]);
  });

  it("counts a list whose every place was already claimed as unused", () => {
    // `rom` adds nothing once `maccis` has taken Trevi and Kolosseum is not
    // in it — so a legend row for it would point at no pin on the map.
    const { used } = resolvePlaceListColors([
      { ...maccis, entries: [{ placeId: "trevi" }] },
      { ...rom, entries: [{ placeId: "trevi" }] },
    ]);
    expect(used.map((l) => l.id)).toEqual(["l1"]);
  });
});

describe("resolvePlaceColor in list mode", () => {
  it("uses the resolved list colour", () => {
    expect(resolvePlaceColor({ visited: true, listColor: [1, 2, 3] }, listMode)).toEqual([1, 2, 3]);
  });

  it("falls back to the unlisted colour, not to the domain colour", () => {
    expect(resolvePlaceColor({ visited: true }, listMode)).toEqual(DEFAULT_PLACE_COLORS.unlisted);
  });

  it("ignores listColor in the other modes", () => {
    expect(resolvePlaceColor({ visited: true, listColor: [1, 2, 3] }, DEFAULT_PLACE_COLOR_CONFIG))
      .toEqual(DEFAULT_PLACE_COLORS.solid);
  });
});

describe("buildPlaceLegend", () => {
  it("offers only the fallback slot in list mode — list colours are edited on the list", () => {
    expect(slotsForPlaceMode("list")).toEqual(["unlisted"]);
  });

  it("names each contributing list and keeps the fallback row last", () => {
    const { used } = resolvePlaceListColors([maccis, rom]);
    const rows = buildPlaceLegend(listMode, used);
    expect(rows.map((r) => r.slot)).toEqual(["list:l1", "list:l2", "unlisted"]);
    expect(rows[0].label).toBe("Maccis weltweit");
    // The built-in row carries no label: the caller translates its slot.
    expect(rows[2].label).toBeUndefined();
  });

  it("still renders an honest single row when there are no lists at all", () => {
    expect(buildPlaceLegend(listMode).map((r) => r.slot)).toEqual(["unlisted"]);
  });

  it("leaves the other modes exactly as they were", () => {
    expect(buildPlaceLegend(DEFAULT_PLACE_COLOR_CONFIG).map((r) => r.slot)).toEqual(["solid"]);
    expect(
      buildPlaceLegend({ ...DEFAULT_PLACE_COLOR_CONFIG, mode: "visited" }).map((r) => r.slot)
    ).toEqual(["visited", "wishlist"]);
  });
});

/**
 * A pin's colour and its symbol must come from the SAME list.
 *
 * "First list wins" is one rule with two consequences, and resolving the two
 * separately is how a place ends up wearing the Maccis colour and the Rome
 * symbol. The resolver therefore hands out both together.
 */
describe("list membership resolves colour and label as one", () => {
  const maccis = {
    id: "maccis",
    name: "Maccis",
    color: "#5ec2b2",
    labelMode: "icon" as const,
    icon: "🍟",
    entries: [{ placeId: "trevi" }, { placeId: "hafen" }],
  };
  const rome = {
    id: "rome",
    name: "Rom",
    color: "#d9975e",
    labelMode: "name" as const,
    icon: "🏛️",
    entries: [{ placeId: "trevi" }, { placeId: "kolosseum" }],
  };

  it("gives a place in two lists the first list's colour AND its symbol", () => {
    const { byPlaceId, labelsByPlaceId } = resolvePlaceListColors([maccis, rome]);
    expect(byPlaceId.get("trevi")).toEqual([94, 194, 178]);
    expect(labelsByPlaceId.get("trevi")).toEqual({ labelMode: "icon", icon: "🍟" });
  });

  it("follows the winner when the order is reversed", () => {
    // The user reorders their lists by dragging; both consequences move together.
    const { byPlaceId, labelsByPlaceId } = resolvePlaceListColors([rome, maccis]);
    expect(byPlaceId.get("trevi")).toEqual([217, 151, 94]);
    expect(labelsByPlaceId.get("trevi")).toEqual({ labelMode: "name", icon: "🏛️" });
  });

  it("leaves a place in no list out of both maps", () => {
    const { byPlaceId, labelsByPlaceId } = resolvePlaceListColors([maccis]);
    expect(byPlaceId.has("kolosseum")).toBe(false);
    expect(labelsByPlaceId.has("kolosseum")).toBe(false);
  });

  it("reads a list that predates the column as wanting names", () => {
    // `labelMode` is NOT NULL with a default, but a cached API response from
    // before the column existed carries neither it nor an icon.
    const legacy = { id: "l", name: "Alt", color: "#5ec2b2", entries: [{ placeId: "p" }] };
    expect(resolvePlaceListColors([legacy]).labelsByPlaceId.get("p")).toEqual({
      labelMode: "name",
      icon: null,
    });
  });
});

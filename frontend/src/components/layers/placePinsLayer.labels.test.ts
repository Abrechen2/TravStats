import { beforeAll, describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import { buildPlacePins } from "./placePinsLayer";
import type { Place } from "../../types/place";
import { clearEmojiSpriteCache } from "./emojiSprite";
import type { PlaceLabelList } from "../../lib/placeLabel";

/**
 * jsdom has no 2D canvas, so the emoji rasteriser would find no context and
 * every symbol would honestly downgrade to a name — which is the fallback, not
 * the behaviour under test. The stub supplies the two calls the rasteriser
 * makes and nothing else, so everything the layer itself decides (which places
 * get a symbol, which get a name, what the budget does) stays real.
 */
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = ((kind: string) =>
    kind === "2d"
      ? ({ clearRect() {}, fillText() {}, set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {} } as unknown as CanvasRenderingContext2D)
      : null) as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,stub";
});

function place(over: Partial<Place> & { id: string }): Place {
  return {
    name: "Some Place",
    category: "restaurant",
    lat: 50,
    lon: 8,
    city: null,
    country: null,
    visitCount: 1,
    visited: true,
    ...over,
  } as Place;
}

const MACCIS: PlaceLabelList = { labelMode: "icon", icon: "🍟" };
const HOTELS: PlaceLabelList = { labelMode: "name", icon: "🏨" };

function build(
  places: readonly Place[],
  listLabels: Map<string, PlaceLabelList>,
  labelSource: "list" | "name" | "icon" | undefined
): { texts: string[]; glyphs: string[] } {
  clearEmojiSpriteCache();
  const layers = buildPlacePins(places, 1, 8, {
    labelsMode: "all",
    labelSource,
    listLabels,
  }) as Layer[];
  const text = layers.find((l) => l.id === "place-pins-labels");
  const icons = layers.find((l) => l.id === "place-pins-symbols");
  const rows = (l: Layer | undefined): { shortLabel: string; label: { kind: string; glyph?: string } }[] =>
    ((l?.props as { data?: unknown[] } | undefined)?.data ?? []) as never;
  return {
    texts: rows(text).map((d) => d.shortLabel),
    glyphs: rows(icons).map((d) => d.label.glyph ?? ""),
  };
}

describe("place pins: symbol or name", () => {
  const maccis = place({ id: "a", name: "McDonald's Hafen" });
  const hotel = place({ id: "b", name: "Hotel Adlon" });
  const loose = place({ id: "c", name: "Kein Listeneintrag" });
  const lists = new Map<string, PlaceLabelList>([
    ["a", MACCIS],
    ["b", HOTELS],
  ]);

  it("draws the symbol INSTEAD of the name, never both", () => {
    // The whole point of the chosen variant: the glyph takes the label's slot.
    // A place appearing in both layers would be the "symbol additionally"
    // variant, which was considered and not chosen.
    const { texts, glyphs } = build([maccis, hotel, loose], lists, "list");
    expect(glyphs).toEqual(["🍟"]);
    expect(texts).toEqual(["Hotel Adlon", "Kein Listeneintrag"]);
  });

  it("lets the map override every list at once", () => {
    expect(build([maccis, hotel, loose], lists, "name")).toEqual({
      texts: ["McDonald's Hafen", "Hotel Adlon", "Kein Listeneintrag"],
      glyphs: [],
    });
    const forced = build([maccis, hotel, loose], lists, "icon");
    expect(forced.glyphs).toEqual(["🍟", "🏨"]);
    // The place in no list keeps its name — "always symbols" cannot invent one.
    expect(forced.texts).toEqual(["Kein Listeneintrag"]);
  });

  it("defers to the lists when the map has no stored preference", () => {
    // An existing user's localStorage predates this setting.
    const { glyphs } = build([maccis, hotel], lists, undefined);
    expect(glyphs).toEqual(["🍟"]);
  });

  it("keeps the dot for every place, symbol or not", () => {
    // The dot carries the list colour and visited-vs-wishlist. Whatever the
    // label does, it must not take the dot with it.
    clearEmojiSpriteCache();
    const layers = buildPlacePins([maccis, hotel, loose], 1, 8, {
      labelsMode: "all",
      labelSource: "icon",
      listLabels: lists,
    }) as Layer[];
    const dots = layers.find((l) => l.id === "place-pins");
    expect(((dots?.props as { data: unknown[] }).data ?? []).length).toBe(3);
  });

  it("puts symbols through the same label budget as names", () => {
    // Symbols that ignored the budget would pile into an unreadable heap
    // exactly where a list is dense, while the names beside them thinned out.
    clearEmojiSpriteCache();
    const dense = Array.from({ length: 40 }, (_, i) =>
      place({ id: `p${i}`, name: `Filiale ${i}`, lat: 50 + i * 0.0001, lon: 8 + i * 0.0001 })
    );
    const denseLists = new Map<string, PlaceLabelList>(dense.map((p) => [p.id, MACCIS]));
    const layers = buildPlacePins(dense, 1, 2, {
      labelsMode: "important",
      labelSource: "list",
      listLabels: denseLists,
    }) as Layer[];
    const icons = layers.find((l) => l.id === "place-pins-symbols");
    const shown = ((icons?.props as { data: unknown[] } | undefined)?.data ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(dense.length);
  });
});

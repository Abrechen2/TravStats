import { describe, expect, it } from "vitest";
import { resolvePlaceLabel, type PlaceLabelSource } from "../placeLabel";

/**
 * Two levels decide what a place on the map is labelled with: the list carries
 * a default, the map's own control can override it for the whole map. This
 * function is the single place the two meet — the layer, the legend and the
 * control panel all read the answer from here rather than each deciding again.
 */
const maccis = { labelMode: "icon" as const, icon: "🍟" };
const hotels = { labelMode: "name" as const, icon: "🏨" };
const plain = { labelMode: "name" as const, icon: null };

function label(source: PlaceLabelSource, list: { labelMode: "name" | "icon"; icon: string | null } | null) {
  return resolvePlaceLabel({ source, list });
}

describe("resolvePlaceLabel", () => {
  it("follows the list when the map defers to it", () => {
    expect(label("list", maccis)).toEqual({ kind: "icon", glyph: "🍟" });
    expect(label("list", hotels)).toEqual({ kind: "name" });
  });

  it("overrides the list in both directions", () => {
    // The whole point of the map control: one flip shows every name again
    // without touching a single list, and one flip back restores the symbols.
    expect(label("name", maccis)).toEqual({ kind: "name" });
    expect(label("icon", hotels)).toEqual({ kind: "icon", glyph: "🏨" });
  });

  it("falls back to the name when there is no symbol to draw", () => {
    // "Always symbols" cannot invent one. A list without an icon keeps its
    // names, which is the only honest answer and also the readable one.
    expect(label("icon", plain)).toEqual({ kind: "name" });
    expect(label("list", { labelMode: "icon", icon: null })).toEqual({ kind: "name" });
  });

  it("treats a blank symbol as no symbol", () => {
    // The emoji input can be cleared to whitespace; a space rendered as a pin
    // would be an invisible marker rather than a label.
    expect(label("icon", { labelMode: "icon", icon: "   " })).toEqual({ kind: "name" });
  });

  it("labels a place in no list with its name, whatever the map says", () => {
    // Places outside every list have no symbol to inherit. "Always symbols"
    // must not silently erase them from the map.
    expect(label("icon", null)).toEqual({ kind: "name" });
    expect(label("list", null)).toEqual({ kind: "name" });
    expect(label("name", null)).toEqual({ kind: "name" });
  });

  it("defaults to deferring to the list when the map has no stored preference", () => {
    // An existing user's localStorage predates this setting; absent must mean
    // "as the list says", not "always names", or turning a list to symbols
    // would appear to do nothing.
    expect(resolvePlaceLabel({ source: undefined, list: maccis })).toEqual({
      kind: "icon",
      glyph: "🍟",
    });
  });
});

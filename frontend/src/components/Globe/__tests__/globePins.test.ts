import { describe, it, expect } from "vitest";
import { lodgingLabelPoints, placeLabelPoints } from "../globePinLabels";
import { DEFAULT_LODGING_COLOR_CONFIG, DEFAULT_LODGING_COLORS } from "../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../lib/placeColor";
import { rgbCss } from "../../../lib/flightColor";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";

/**
 * The pill labels of lodging and place pins. The pins themselves are native
 * MapLibre layers since forgejo#331 and are tested in
 * `native/__tests__/nativeGlobeLayers.test.ts`.
 */

function lodging(id: string, over: Partial<Lodging> = {}): Lodging {
  return {
    id,
    name: "Hotel " + id,
    type: "hotel",
    lat: 50,
    lon: 8,
    city: "Frankfurt",
    country: "DE",
    stayCount: 2,
    nights: 5,
    chainId: null,
    overallRating: null,
    ...over,
  } as unknown as Lodging;
}

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    name: "Place " + id,
    category: "nature",
    lat: 48,
    lon: 11,
    city: "München",
    country: "DE",
    visited: true,
    visitCount: 3,
    ...over,
  } as unknown as Place;
}

describe("globePinLabels", () => {
  it("gives every drawable lodging a pill weighted by its stays", () => {
    const pills = lodgingLabelPoints(
      [lodging("a", { stayCount: 4 }), lodging("b", { lat: null })],
      DEFAULT_LODGING_COLOR_CONFIG
    );
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({ kind: "lodging", id: "a", weight: 4, lng: 8, lat: 50 });
    expect(pills[0].color).toBe(rgbCss(DEFAULT_LODGING_COLORS.solid));
  });

  it("truncates a long hotel name on the same budget the flat label uses", () => {
    const pills = lodgingLabelPoints(
      [lodging("a", { name: "Kempinski Hotel Bristol Berlin" })],
      DEFAULT_LODGING_COLOR_CONFIG
    );
    expect(pills[0].text).toBe("Kempinski Hotel Bri…");
  });

  it("renders a list's SYMBOL where the flat map can only render the name", () => {
    // deck.gl's font atlas cannot produce colour emoji (placePinsLayer.ts
    // records the black-box measurement); a DOM pill can, so the globe
    // honours the list's icon directly.
    const pills = placeLabelPoints(
      [place("a")],
      DEFAULT_PLACE_COLOR_CONFIG,
      undefined,
      new Map([["a", { labelMode: "icon", icon: "🌳" }]]),
      "list"
    );
    expect(pills[0].text).toBe("🌳");
  });

  it("falls back to the name when the map-wide override says names", () => {
    const pills = placeLabelPoints(
      [place("a")],
      DEFAULT_PLACE_COLOR_CONFIG,
      undefined,
      new Map([["a", { labelMode: "icon", icon: "🌳" }]]),
      "name"
    );
    expect(pills[0].text).toBe("Place a");
  });
});

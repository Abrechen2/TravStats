import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import { buildPlacePins } from "./placePinsLayer";
import { DEFAULT_PLACE_COLORS } from "../../lib/placeColor";
import type { Place } from "../../types/place";

const place = (id: string, visited: boolean): Place =>
  ({
    id,
    name: id,
    category: "landmark",
    lat: 1,
    lon: 2,
    city: null,
    country: null,
    visited,
    visitCount: visited ? 1 : 0,
    plannedVisitCount: 0,
  }) as Place;

function pins(greyUnvisited: boolean): {
  fill: (d: unknown) => number[];
  line: (d: unknown) => number[];
  data: unknown[];
} {
  const layers = buildPlacePins([place("seen", true), place("open", false)], 1, 8, {
    greyUnvisited,
  }) as Layer[];
  const dots = layers.find((l) => l.id === "place-pins") as unknown as {
    props: {
      getFillColor: (d: unknown) => number[];
      getLineColor: (d: unknown) => number[];
      data: unknown[];
    };
  };
  return { fill: dots.props.getFillColor, line: dots.props.getLineColor, data: dots.props.data };
}

describe("place pins in a list view", () => {
  it("draws an unvisited member as a hollow ring in the muted wishlist colour, a visited one normally", () => {
    const { fill, line, data } = pins(true);
    const [seen, open] = data;
    expect(fill(open)[3]).toBe(0);
    expect(line(open).slice(0, 3)).toEqual([...DEFAULT_PLACE_COLORS.wishlist]);
    expect(fill(seen).slice(0, 3)).toEqual([...DEFAULT_PLACE_COLORS.solid]);
    expect(fill(seen)[3]).toBeGreaterThan(0);
  });

  it("keeps the wishlist pin's own colour in 'Alle Orte' (no list narrowing the map)", () => {
    const { line, data } = pins(false);
    expect(line(data[1]).slice(0, 3)).toEqual([...DEFAULT_PLACE_COLORS.solid]);
  });
});

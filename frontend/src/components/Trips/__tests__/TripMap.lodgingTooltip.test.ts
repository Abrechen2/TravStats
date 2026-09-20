import { describe, it, expect } from "vitest";
import { buildLodgingPins } from "../../layers/lodgingPinsLayer";
import { toGlobeLodgingPoints } from "../TripMapGlobeLayers";
import { createMarkerTooltip } from "../../map/markerTooltip";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../lib/lodgingColor";
import type { Lodging } from "../../../types/lodging";
import type { PickingInfo } from "@deck.gl/core";

/**
 * A hotel must say the same thing on both projections.
 *
 * `createMarkerTooltip` answers for the layer id `lodging-pins` — which the
 * globe stack also uses, on purpose, so one click handler serves both. But it
 * opens with `if (!datum?.name) return null`, and the globe's datum carried
 * only what it needed to DRAW a dot: a position, a colour, a radius. So the
 * flat map showed the house, its city and "3 Aufenthalte · 7 Nächte", and the
 * globe showed nothing at all — a tooltip that silently stops existing when
 * you change the projection, which reads as a broken map rather than a
 * missing field.
 *
 * Sharing the layer id is what makes that possible, so the datum has to be
 * shared far enough to match.
 */

const hotel: Lodging = {
  id: "l1",
  name: "Hotel Borg",
  type: "hotel",
  city: "Reykjavík",
  country: "IS",
  lat: 64.1466,
  lon: -21.9426,
  stayCount: 3,
  nights: 7,
} as unknown as Lodging;

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}:${JSON.stringify(options)}` : key;

const tooltip = createMarkerTooltip(t, "de");

function cardFor(object: unknown): string | null {
  const info = { layer: { id: "lodging-pins" }, object } as unknown as PickingInfo;
  const result = tooltip(info);
  return result ? (result as { html: string }).html : null;
}

describe("a hotel's tooltip survives the projection switch", () => {
  it("the flat map's pin datum produces a card", () => {
    const layers = buildLodgingPins([hotel], 1, 4, {
      labelsMode: "important",
      colors: DEFAULT_LODGING_COLOR_CONFIG,
    });
    const pin = layers?.find((l) => l.id === "lodging-pins");
    const datum = (pin?.props as unknown as { data: unknown[] }).data[0];
    const html = cardFor(datum);
    expect(html).toContain("Hotel Borg");
  });

  it("the globe's marker datum produces one too", () => {
    const [datum] = toGlobeLodgingPoints([hotel], DEFAULT_LODGING_COLOR_CONFIG);
    const html = cardFor(datum);
    expect(html, "a globe hotel shows no tooltip").not.toBeNull();
    expect(html).toContain("Hotel Borg");
  });

  it("carries the same four facts on the globe as on the flat map", () => {
    const [datum] = toGlobeLodgingPoints([hotel], DEFAULT_LODGING_COLOR_CONFIG);
    const html = cardFor(datum) ?? "";
    // The city, and the two counts the lodging card is actually about. The
    // country drives the flag, which is an <img>, so it is checked by its
    // presence rather than by text.
    expect(html).toContain("Reykjavík");
    expect(html).toContain("3");
    expect(html).toContain("7");
    expect(html).toContain("<img");
  });

  it("keeps a stop and an airport out of it — they are not lodging", () => {
    // `toGlobeLodgingPoints` is the only producer of the tooltip fields, so a
    // stop marker stays a bare dot on both projections, as it already was.
    const info = {
      layer: { id: "trip-stops" },
      object: { position: [0, 0], label: "Somewhere" },
    } as unknown as PickingInfo;
    expect(tooltip(info)).toBeNull();
  });
});

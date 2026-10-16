import { describe, expect, it, vi } from "vitest";
import type { JSX } from "react";
import { buildFerryLegendRows, FERRY_OVERLAY } from "../ferryMapOverlay";
import { buildTerminalRideMapLayers } from "../terminalRideMapOverlay";
import type { FerryJourney } from "../../../../types/ferry";

/**
 * Ferry on the "Alle" map: its crossings were the one transport line the map
 * did not draw. The layer and its key come from the ferry colour it is handed
 * (the domain colour store's value) and name only the kinds of line drawn.
 */
const crossing = (over: Partial<FerryJourney> = {}): FerryJourney =>
  ({
    id: "f1",
    status: "completed",
    depLat: 54.32,
    depLon: 10.14,
    arrLat: 57.71,
    arrLon: 11.97,
    geometry: null,
    ...over,
  }) as FerryJourney;

const t = (key: string): string => key;
const row = vi.fn(
  (background: string, label: string, key: string) =>
    ({ key, props: { background, label } }) as unknown as JSX.Element
);

describe("ferry layer of the 'Alle' map", () => {
  it("draws one path per crossing in the colour it is handed, under its own id", () => {
    const [layer] = buildTerminalRideMapLayers(
      [crossing()],
      "#2a9d8f",
      false,
      FERRY_OVERLAY.idPrefix
    );
    expect(layer.id).toBe("all-ferry-paths");
    const props = layer.props as unknown as {
      data: { routed: boolean }[];
      getColor: (d: { routed: boolean }) => number[];
    };
    expect(props.data).toHaveLength(1);
    expect(props.getColor({ routed: false })).toEqual([42, 157, 143, 170]);
  });

  it("leaves a cancelled crossing off the map", () => {
    expect(
      buildTerminalRideMapLayers([crossing({ status: "cancelled" })], "#2a9d8f", false, "x")
    ).toEqual([]);
  });

  it("keys a chord as Luftlinie and a drawn lane as the ferry, in its own words", () => {
    row.mockClear();
    buildFerryLegendRows([crossing()], "#2a9d8f", t, row);
    expect(row.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["dashboard:legend.ferryStraight", "ferry-straight"],
    ]);
    row.mockClear();
    const lane: [number, number][] = [
      [10.14, 54.32],
      [11.0, 56.0],
      [11.97, 57.71],
    ];
    buildFerryLegendRows([crossing({ geometry: lane })], "#2a9d8f", t, row);
    expect(row.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["dashboard:legend.ferry", "ferry-drawn"],
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { JSX } from "react";
import { buildBusLegendRows, buildBusMapLayers } from "../busMapOverlay";
import type { BusJourney } from "../../../../types/bus";

const ride = (over: Partial<BusJourney> = {}): BusJourney =>
  ({
    id: "r1",
    depLat: 37.5,
    depLon: 127.0,
    arrLat: 38.2,
    arrLon: 128.6,
    geometry: null,
    ...over,
  }) as BusJourney;

const t = (key: string): string => key;
const row = vi.fn(
  (background: string, label: string, key: string) =>
    ({ key, props: { background, label } }) as unknown as JSX.Element
);

/** forgejo#180: bus on the "Alle" map, coloured by the domain colour store, legend in step. */
describe("bus layer of the 'Alle' map (forgejo#180)", () => {
  it("draws one path per ride in the colour it is handed", () => {
    const [layer] = buildBusMapLayers([ride()], "#c49a6c", false);
    expect(layer.id).toBe("dashboard-bus-paths");
    const props = layer.props as unknown as {
      data: { routed: boolean }[];
      getColor: (d: { routed: boolean }) => number[];
    };
    expect(props.data).toHaveLength(1);
    expect(props.getColor({ routed: true })).toEqual([196, 154, 108, 255]);
  });

  it("lifts the line off the globe and draws nothing without rides", () => {
    const [layer] = buildBusMapLayers([ride()], "#c49a6c", true);
    const props = layer.props as unknown as {
      data: { path: [number, number][] }[];
      getPath: (d: { path: [number, number][] }) => number[][];
    };
    expect(props.getPath(props.data[0])[0][2]).toBeGreaterThan(0);
    expect(buildBusMapLayers([], "#c49a6c", false)).toEqual([]);
  });

  it("keys only the kinds of line actually drawn", () => {
    row.mockClear();
    buildBusLegendRows([ride()], "#c49a6c", t, row);
    expect(row.mock.calls.map((c) => c[2])).toEqual(["bus-straight"]);
    row.mockClear();
    const road: [number, number][] = [
      [127, 37.5],
      [128.6, 38.2],
    ];
    buildBusLegendRows([ride({ geometry: road }), ride({ id: "r2" })], "#c49a6c", t, row);
    expect(row.mock.calls.map((c) => c[2])).toEqual(["bus-road", "bus-straight"]);
    expect(buildBusLegendRows([], "#c49a6c", t, row)).toEqual([]);
  });
});

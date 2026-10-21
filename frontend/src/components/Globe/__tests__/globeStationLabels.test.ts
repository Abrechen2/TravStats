import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import { stationLabelPoints } from "../globePinLabels";
import {
  buildStationLabelLayers,
  StationLabelsLayer,
  type StationLabelSource,
} from "../../layers/stationLabelsLayer";

/**
 * Codex review of forgejo#320: on the globe the station layer returned nothing
 * and the HTML label overlay — the only route a name has onto the sphere —
 * was never told about stations, so switching to the globe dropped every
 * station name, even with labels on "all". The names now reach the overlay
 * from the same layer the flat map draws, with the same rides (and so the
 * same domain filter), colour and weight.
 */
const ride = (over: Partial<StationLabelSource> = {}): StationLabelSource => ({
  status: "completed",
  depStationName: "Berlin Hbf",
  depLat: 52.525,
  depLon: 13.369,
  arrStationName: "Hamburg Hbf",
  arrLat: 53.553,
  arrLon: 10.007,
  ...over,
});

const onGlobe = (groups: Parameters<typeof buildStationLabelLayers>[0]) =>
  buildStationLabelLayers(groups, { labelsMode: "all", idPrefix: "all-transport", onGlobe: true });

describe("station names on the globe", () => {
  it("hand every station to the overlay, in its domain colour and by usage", () => {
    const layers = onGlobe([
      { rides: [ride(), ride()], color: [1, 2, 3] },
      { rides: [ride({ depStationName: "Kiel", depLat: 54.3, depLon: 10.1 })], color: [9, 8, 7] },
    ]);
    const labels = stationLabelPoints(layers);
    expect(labels.map((l) => [l.text, l.weight, l.color])).toEqual([
      ["Berlin Hbf", 2, "rgb(1,2,3)"],
      ["Hamburg Hbf", 2, "rgb(1,2,3)"],
      ["Kiel", 1, "rgb(9,8,7)"],
      ["Hamburg Hbf", 1, "rgb(9,8,7)"],
    ]);
    expect(labels.every((l) => l.kind === "station")).toBe(true);
  });

  it("names nothing for a domain the filter emptied, or with labels off", () => {
    expect(stationLabelPoints(onGlobe([{ rides: [], color: [1, 2, 3] }]))).toEqual([]);
    const off = buildStationLabelLayers([{ rides: [ride()], color: [1, 2, 3] }], {
      labelsMode: "off",
      idPrefix: "x",
      onGlobe: true,
    });
    expect(stationLabelPoints(off)).toEqual([]);
  });

  it("draws no deck.gl text on the globe, where billboard text does not render", () => {
    const [layer] = onGlobe([{ rides: [ride()], color: [1, 2, 3] }]);
    expect(layer).toBeInstanceOf(StationLabelsLayer);
    expect((layer as StationLabelsLayer).renderLayers()).toEqual([]);
  });

  it("ignores every other layer it is handed", () => {
    expect(stationLabelPoints([{ id: "rail-paths", props: {} } as unknown as Layer])).toEqual([]);
  });
});

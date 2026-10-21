import { describe, expect, it } from "vitest";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { labelObstaclesOf, withLabelObstacles } from "../labelObstacles";
import { estimateLabelBox } from "../labelPriority";
import {
  buildStationLabelLayers,
  selectStationLabels,
  StationLabelsLayer,
  type StationLabelDatum,
} from "../../layers/stationLabelsLayer";
import { buildLodgingPins } from "../../layers/lodgingPinsLayer";
import type { Lodging } from "../../../types/lodging";

/**
 * forgejo#320, owner UAT: on the overview map a station name was printed over
 * an airport code, a hotel or a place. Each of those layers spaced out its
 * OWN labels, and the station layer — built outside the map — spaced out its
 * own, so nothing compared a station with an airport. The labels the map
 * already shows are now obstacles in the station layer's collision pass.
 */

const BER: [number, number] = [13.4, 52.5];

interface AirportLabel {
  p: [number, number];
  t: string;
}

const airportLabels = (data: AirportLabel[], over: Record<string, unknown> = {}) =>
  new TextLayer<AirportLabel>({
    id: "routes-labels",
    data,
    getPosition: (d) => d.p,
    getText: (d) => d.t,
    getSize: 12,
    background: true,
    backgroundPadding: [5, 3, 5, 3],
    getPixelOffset: [0, -20],
    ...over,
  });

const station = (key: string, position: [number, number], count = 5): StationLabelDatum => ({
  key,
  name: key,
  shortLabel: key,
  position,
  count,
  color: [1, 2, 3],
  box: estimateLabelBox(key, 11, [4, 2]),
});

describe("labelObstaclesOf", () => {
  it("reads every shown label's position, box and offset from the map's text layers", () => {
    const obstacles = labelObstaclesOf([airportLabels([{ p: BER, t: "BER" }])]);
    expect(obstacles).toEqual([
      {
        position: BER,
        width: estimateLabelBox("BER", 12, [5, 3]).width,
        height: estimateLabelBox("BER", 12, [5, 3]).height,
        offsetY: -20,
      },
    ]);
  });

  it("skips dots, hidden label layers and the station labels themselves", () => {
    const dots = new ScatterplotLayer<AirportLabel>({
      id: "routes-dot",
      data: [{ p: BER, t: "BER" }],
      getPosition: (d) => d.p,
    });
    const hidden = airportLabels([{ p: BER, t: "BER" }], { id: "hidden", visible: false });
    const stations = buildStationLabelLayers(
      [
        {
          rides: [
            {
              status: "completed",
              depStationName: "Berlin Hbf",
              depLon: 13.369,
              depLat: 52.525,
              arrStationName: "Hamburg Hbf",
              arrLon: 10.007,
              arrLat: 53.553,
            },
          ],
          color: [1, 2, 3],
        },
      ],
      { labelsMode: "important", idPrefix: "rail" }
    );
    expect(labelObstaclesOf([dots as Layer, hidden as Layer, ...stations])).toEqual([]);
  });

  it("reads a real hotel label layer", () => {
    const lodging = {
      id: "l1",
      name: "Hotel Adlon",
      lat: BER[1],
      lon: BER[0],
      stayCount: 3,
      nights: 6,
      type: "hotel",
      city: "Berlin",
      country: "DE",
    } as unknown as Lodging;
    const layers = buildLodgingPins([lodging], 1, 8, { labelsMode: "important" }) ?? [];
    const obstacles = labelObstaclesOf(layers);
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0].position).toEqual(BER);
    expect(obstacles[0].offsetY).toBe(-16);
  });
});

describe("station labels yield to the labels the map already shows", () => {
  it("drops a station whose name would sit on an airport code, keeps one elsewhere", () => {
    const obstacles = labelObstaclesOf([airportLabels([{ p: BER, t: "BER" }])]);
    // 0.01° east of the airport: well inside one airport pill at zoom 10.
    const onTop = station("Berlin Ostkreuz", [BER[0] + 0.01, BER[1]]);
    const clear = station("Hamburg Hbf", [10.007, 53.553]);
    const shown = selectStationLabels([onTop, clear], "important", 10, obstacles);
    expect(shown.map((s) => s.key)).toEqual(["Hamburg Hbf"]);
    // Without obstacles both names had shown — the defect.
    expect(selectStationLabels([onTop, clear], "important", 10).map((s) => s.key)).toEqual([
      "Berlin Ostkreuz",
      "Hamburg Hbf",
    ]);
  });

  it("compares the boxes where they are drawn, each at its own pixel offset", () => {
    // A station far enough BELOW the airport that the airport's pill (lifted
    // 20 px) and the station's (lifted 14 px) do not meet at zoom 10.
    const obstacles = labelObstaclesOf([airportLabels([{ p: BER, t: "BER" }])]);
    const below = station("Südkreuz", [BER[0], BER[1] - 0.05]);
    expect(selectStationLabels([below], "important", 10, obstacles)).toHaveLength(1);
  });

  it("leaves 'all' alone — the user asked for every name", () => {
    const obstacles = labelObstaclesOf([airportLabels([{ p: BER, t: "BER" }])]);
    const onTop = station("Berlin Ostkreuz", [BER[0] + 0.01, BER[1]]);
    expect(selectStationLabels([onTop], "all", 10, obstacles)).toHaveLength(1);
  });

  it("hands the obstacles to the station layer and leaves every other layer as it was", () => {
    const airports = airportLabels([{ p: BER, t: "BER" }]);
    const stationLayer = new StationLabelsLayer({
      id: "all-station-labels",
      data: [station("Berlin Ostkreuz", [BER[0] + 0.01, BER[1]])],
      labelsMode: "important",
    });
    const other = new ScatterplotLayer({ id: "rail-lines", data: [] });
    const out = withLabelObstacles([other, stationLayer], [airports]);
    expect(out[0]).toBe(other);
    expect(out[1]).toBeInstanceOf(StationLabelsLayer);
    expect((out[1] as StationLabelsLayer).props.obstacles).toEqual(labelObstaclesOf([airports]));
  });

  it("returns the very same array when there is no station layer, so memos hold", () => {
    const extra = [new ScatterplotLayer({ id: "rail-lines", data: [] })];
    expect(withLabelObstacles(extra, [airportLabels([{ p: BER, t: "BER" }])])).toBe(extra);
  });
});

import { describe, expect, it } from "vitest";
import { WebMercatorViewport, type Layer } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import {
  buildStationLabels,
  StationLabelsLayer,
  type StationLabelDatum,
  type StationLabelSource,
} from "../stationLabelsLayer";
import { labelObstaclesOf } from "../../map/labelObstacles";
import type { LabelsMode, PlacedLabel } from "../../map/labelPriority";

/**
 * beta.22 UAT: with "Alle" chosen in the label switch (a choice that follows
 * the account to every device), "Kiel Hbf" and "Kiel Norwegenkai" were drawn
 * exactly on top of each other at every zoom, and "Hamburg Hbf", "Hamburg
 * ZOB" and the airport's "HAM" stacked into one smudge. "All" asks for every
 * name — not for names nobody can read. These rides use the UAT's real
 * coordinates.
 */
const KIEL_HBF: [number, number] = [10.1318, 54.3147];
const KIEL_NORWEGENKAI: [number, number] = [10.1386, 54.3167];
const HAMBURG_HBF: [number, number] = [10.0069, 53.553];
const HAMBURG_ZOB: [number, number] = [10.0115, 53.5517];
const HAM: [number, number] = [9.9882, 53.6304];
const COCHEM: [number, number] = [7.1667, 50.1525];
const REICHSBURG_COCHEM: [number, number] = [7.165, 50.146];
const OSLO: [number, number] = [10.7461, 59.9111];

const ride = (
  dep: string,
  [depLon, depLat]: [number, number],
  arr: string,
  [arrLon, arrLat]: [number, number]
): StationLabelSource => ({
  status: "completed",
  depStationName: dep,
  depLat,
  depLon,
  arrStationName: arr,
  arrLat,
  arrLon,
});

const stations: StationLabelDatum[] = [
  ...buildStationLabels(
    [
      ride("Hamburg Hbf", HAMBURG_HBF, "Kiel Hbf", KIEL_HBF),
      ride("Köln Hbf", [6.9589, 50.9429], "Cochem (Mosel)", COCHEM),
    ],
    [160, 140, 255]
  ),
  ...buildStationLabels([ride("Hamburg ZOB", HAMBURG_ZOB, "Kiel Hbf", KIEL_HBF)], [200, 150, 90]),
  ...buildStationLabels(
    [ride("Kiel Norwegenkai", KIEL_NORWEGENKAI, "Oslo Color Line Terminal", OSLO)],
    [90, 140, 220]
  ),
];

/** The airport and place labels the map already shows, as `DeckGLMap` hands them over. */
const mapLabels = new TextLayer<{ p: [number, number]; t: string; offset: number }>({
  id: "map-labels",
  data: [
    { p: HAM, t: "HAM", offset: -20 },
    { p: REICHSBURG_COCHEM, t: "Reichsburg Cochem", offset: -16 },
  ],
  getPosition: (d) => d.p,
  getText: (d) => d.t,
  getSize: 12,
  background: true,
  backgroundPadding: [5, 3, 5, 3],
  getPixelOffset: (d) => [0, d.offset],
});

type Accessor<V> = V | ((d: StationLabelDatum) => V);
type TextProps = {
  data: StationLabelDatum[];
  getText: (d: StationLabelDatum) => string;
  getPixelOffset: Accessor<readonly [number, number]>;
};

interface ScreenBox {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function drawnAt(
  mode: LabelsMode,
  zoom: number,
  [longitude, latitude]: [number, number],
  obstacles: readonly PlacedLabel[]
) {
  const viewport = new WebMercatorViewport({ width: 1440, height: 900, longitude, latitude, zoom });
  const layer = new StationLabelsLayer({ id: "t", data: stations, labelsMode: mode, obstacles });
  Object.assign(layer, {
    context: { viewport },
    state: {},
    setState(this: StationLabelsLayer, patch: object) {
      Object.assign(this.state, patch);
    },
  });
  layer.updateState();
  const [text] = layer.renderLayers() as Layer[];
  const props = text.props as unknown as TextProps;
  const boxes: ScreenBox[] = props.data.map((d) => {
    const offset =
      typeof props.getPixelOffset === "function" ? props.getPixelOffset(d) : props.getPixelOffset;
    const [x, y] = viewport.project(d.position);
    const cx = x + offset[0];
    const cy = y + offset[1];
    return {
      text: props.getText(d),
      x0: cx - d.box.width / 2,
      x1: cx + d.box.width / 2,
      y0: cy - d.box.height / 2,
      y1: cy + d.box.height / 2,
    };
  });
  const obstacleBoxes: ScreenBox[] = obstacles.map((o) => {
    const [x, y] = viewport.project([o.position[0], o.position[1]]);
    return {
      text: "obstacle",
      x0: x - o.width / 2,
      x1: x + o.width / 2,
      y0: y + o.offsetY - o.height / 2,
      y1: y + o.offsetY + o.height / 2,
    };
  });
  return { labels: boxes, obstacles: obstacleBoxes };
}

const overlapping = (labels: ScreenBox[], obstacles: ScreenBox[]): string[] => {
  const hits: string[] = [];
  const all = [...labels, ...obstacles];
  labels.forEach((a, i) => {
    all.forEach((b, j) => {
      if (j <= i && j < labels.length) return;
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0)
        hits.push(`${a.text} × ${b.text}`);
    });
  });
  return hits;
};

describe("station labels never print one name over another (beta.22 UAT)", () => {
  const obstacles = labelObstaclesOf([mapLabels]);

  for (const zoom of [4, 6, 8, 10, 12]) {
    it(`in "all", prints no name over another at zoom ${zoom}`, () => {
      for (const centre of [KIEL_HBF, HAMBURG_HBF, COCHEM]) {
        const { labels, obstacles: placed } = drawnAt("all", zoom, centre, obstacles);
        expect(overlapping(labels, placed)).toEqual([]);
      }
    });

    it(`in "important", hides a colliding name instead at zoom ${zoom}`, () => {
      for (const centre of [KIEL_HBF, HAMBURG_HBF, COCHEM]) {
        const { labels, obstacles: placed } = drawnAt("important", zoom, centre, obstacles);
        expect(overlapping(labels, placed)).toEqual([]);
      }
    });
  }

  it('in "all", moves the Kiel and Hamburg names beside their dots and shows each once', () => {
    for (const zoom of [8, 10, 12]) {
      const { labels } = drawnAt("all", zoom, KIEL_HBF, obstacles);
      // Every station once: the bus's "Kiel Hbf" is the train's station.
      expect(labels.map((l) => l.text).sort()).toEqual(
        [...new Set(stations.map((s) => s.shortLabel))].sort()
      );
    }
    // Zoomed out, "all" still shows more than "important" does.
    const all = drawnAt("all", 6, KIEL_HBF, obstacles).labels;
    const important = drawnAt("important", 6, KIEL_HBF, obstacles).labels;
    expect(all.length).toBeGreaterThan(important.length);
  });
});

import { describe, expect, it } from "vitest";
import { TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { appendWithLabelObstacles } from "../labelObstacles";
import { estimateLabelBox, projectToWorldPx } from "../labelPriority";

/**
 * beta.22 UAT: with "Alle" chosen, the flat map's own labels — airport codes,
 * cruise ports, hotels, places — were printed over one another, because each
 * layer skipped its spacing in "all" and no pass compared one layer with
 * another. They now share one pass at the map's snapped zoom (the station
 * names already placed around them, forgejo#320). Real coordinates.
 */
interface Label {
  p: [number, number];
  t: string;
  count?: number;
  visits?: number;
  stayCount?: number;
  visitCount?: number;
}

const layer = (
  id: string,
  size: number,
  padding: [number, number] | [number, number, number, number],
  offsetY: number,
  data: Label[]
) =>
  new TextLayer<Label>({
    id,
    data,
    getPosition: (d) => d.p,
    getText: (d) => d.t,
    getSize: size,
    background: true,
    backgroundPadding: padding,
    getPixelOffset: [0, offsetY],
  });

const own = (): Layer[] => [
  layer("routes-labels", 12, [5, 3, 5, 3], -20, [
    { p: [9.9882, 53.6304], t: "HAM", count: 2 },
    { p: [6.9573, 50.8659], t: "CGN", count: 1 },
  ]),
  layer("cruise-ports-labels", 11, [4, 2], -16, [
    { p: [9.9339, 53.5446], t: "Hamburg Cruise Center", visits: 1 },
    { p: [10.1386, 54.3167], t: "Kiel Norwegenkai", visits: 1 },
  ]),
  layer("lodging-pins-labels", 11, [4, 2], -16, [
    { p: [10.0055, 53.5574], t: "Hotel Atlantic", stayCount: 2 },
    { p: [7.167, 50.147], t: "Hotel Cochem", stayCount: 1 },
    { p: [10.135, 54.315], t: "Hotel Kieler Hof", stayCount: 1 },
  ]),
  layer("place-pins-labels", 11, [4, 2], -16, [
    { p: [9.9841, 53.5413], t: "Elbphilharmonie", visitCount: 3 },
    { p: [7.165, 50.146], t: "Reichsburg Cochem", visitCount: 1 },
    { p: [6.9583, 50.9413], t: "Kölner Dom", visitCount: 1 },
  ]),
];

type Accessor<V> = V | ((d: Label) => V);
interface Box {
  t: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function drawnBoxes(layers: Layer[], zoom: number): Box[] {
  const boxes: Box[] = [];
  for (const l of layers) {
    if (!(l instanceof TextLayer)) continue;
    const props = l.props as unknown as {
      data: Label[];
      getSize: number;
      backgroundPadding: number[];
      getPixelOffset: Accessor<readonly [number, number]>;
    };
    for (const d of props.data) {
      const off =
        typeof props.getPixelOffset === "function" ? props.getPixelOffset(d) : props.getPixelOffset;
      const { width, height } = estimateLabelBox(d.t, props.getSize, [
        props.backgroundPadding[0],
        props.backgroundPadding[1],
      ]);
      const [x, y] = projectToWorldPx(d.p[0], d.p[1], zoom);
      const cx = x + off[0];
      const cy = y + off[1];
      boxes.push({
        t: d.t,
        x0: cx - width / 2,
        x1: cx + width / 2,
        y0: cy - height / 2,
        y1: cy + height / 2,
      });
    }
  }
  return boxes;
}

const overlaps = (boxes: Box[]): string[] => {
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) hits.push(`${a.t} × ${b.t}`);
    }
  return hits;
};

describe('the flat map\'s own labels in "all" (beta.22 UAT)', () => {
  for (const zoom of [4, 6, 8, 10, 12]) {
    it(`prints no airport, port, hotel or place name over another at zoom ${zoom}`, () => {
      const layers = appendWithLabelObstacles(own(), [], { labelsMode: "all", zoom });
      // Measured at both ends of the zoom step the pick stands for.
      expect(overlaps(drawnBoxes(layers, zoom - 0.5))).toEqual([]);
      expect(overlaps(drawnBoxes(layers, zoom + 0.49))).toEqual([]);
    });
  }

  it("still shows every name once the map is zoomed in far enough", () => {
    const layers = appendWithLabelObstacles(own(), [], { labelsMode: "all", zoom: 12 });
    expect(drawnBoxes(layers, 12)).toHaveLength(10);
  });
});

/**
 * The same, one mode down: in "Wichtige" each layer thinned its OWN labels,
 * so a hotel and a place across the street ("Hotel Cochem", "Reichsburg
 * Cochem") or an airport and a port still printed over each other. The shared
 * pass now hides the lower-ranked one there, as it does for station names.
 */
describe('the flat map\'s own labels in "important" (beta.22 UAT)', () => {
  for (const zoom of [4, 6, 8, 10, 12]) {
    it(`prints no airport, port, hotel or place name over another at zoom ${zoom}`, () => {
      const layers = appendWithLabelObstacles(own(), [], { labelsMode: "important", zoom });
      expect(overlaps(drawnBoxes(layers, zoom - 0.5))).toEqual([]);
      expect(overlaps(drawnBoxes(layers, zoom + 0.49))).toEqual([]);
    });
  }

  it("hides the lower-ranked name rather than moving it", () => {
    const layers = appendWithLabelObstacles(own(), [], { labelsMode: "important", zoom: 10 });
    const boxes = drawnBoxes(layers, 10);
    // Equal weight (one visit, one stay): either may win, but only one shows,
    // and on its usual spot.
    const cochem = boxes.filter((b) => /Cochem/.test(b.t));
    expect(cochem).toHaveLength(1);
  });
});

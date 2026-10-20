import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import {
  buildStationLabelLayers,
  buildStationLabels,
  selectStationLabels,
  snapLabelZoom,
  StationLabelsLayer,
  toStationLabel,
  type StationLabelDatum,
  type StationLabelSource,
} from "../stationLabelsLayer";
import { estimateLabelBox, labelBudget } from "../../map/labelPriority";

const RGB: [number, number, number] = [1, 2, 3];

/** A station datum with the box its label text would have. */
const datum = (
  over: Partial<StationLabelDatum> & Pick<StationLabelDatum, "key" | "position" | "count">
): StationLabelDatum => {
  const shortLabel = over.shortLabel ?? over.key.toUpperCase();
  return {
    name: shortLabel,
    shortLabel,
    color: RGB,
    box: estimateLabelBox(shortLabel, 11, [4, 2]),
    ...over,
  };
};

/**
 * forgejo#320: rail, bus and ferry rides drew their lines with nameless dots.
 * The names come from the rides themselves, and which ones show is the
 * airport labels' rule — most-used first, more as the map zooms in, none on
 * top of each other.
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

const byName = (labels: readonly StationLabelDatum[]) =>
  Object.fromEntries(labels.map((l) => [l.name, l.count]));

describe("buildStationLabels", () => {
  it("names each station once and counts how often it was used", () => {
    const labels = buildStationLabels(
      [
        ride(),
        ride({ id: "x" } as Partial<StationLabelSource>),
        ride({
          depStationName: "Hamburg Hbf",
          depLat: 53.553,
          depLon: 10.007,
          arrStationName: "Kiel Hbf",
          arrLat: 54.315,
          arrLon: 10.132,
        }),
      ],
      RGB
    );
    expect(byName(labels)).toEqual({ "Berlin Hbf": 2, "Hamburg Hbf": 3, "Kiel Hbf": 1 });
  });

  it("joins two rows of one catalogue station even when their coordinates differ", () => {
    const labels = buildStationLabels(
      [
        ride({ depStationId: 7 }),
        ride({ depStationId: 7, depLat: 52.5251, depLon: 13.3695, depStationName: "Berlin Hbf" }),
      ],
      RGB
    );
    expect(labels.filter((l) => l.name === "Berlin Hbf")).toHaveLength(1);
    expect(byName(labels)["Berlin Hbf"]).toBe(2);
  });

  it("joins a row with an id and one without by name and place", () => {
    const labels = buildStationLabels([ride({ depStationId: 7 }), ride()], RGB);
    expect(byName(labels)["Berlin Hbf"]).toBe(2);
  });

  it("keeps two stations of one name in different places apart", () => {
    const labels = buildStationLabels(
      [
        ride({ arrStationName: "Hauptbahnhof", arrLat: 48.14, arrLon: 11.558 }),
        ride({ arrStationName: "Hauptbahnhof", arrLat: 50.107, arrLon: 8.663 }),
      ],
      RGB
    );
    expect(labels.filter((l) => l.name === "Hauptbahnhof")).toHaveLength(2);
  });

  it("joins two spellings of one place and shows the more used one (Codex review)", () => {
    const at = { depLat: 48.1402, depLon: 11.5583 };
    const labels = buildStationLabels(
      [
        ride({ ...at, depStationName: "Muenchen Hbf" }),
        ride({ ...at, depStationName: "München Hbf" }),
        ride({ depStationName: "München Hbf", depLat: 48.1404, depLon: 11.5586 }),
      ],
      RGB
    );
    const munich = labels.filter((l) => l.name !== "Hamburg Hbf");
    expect(munich).toHaveLength(1);
    expect(munich[0].count).toBe(3);
    expect(munich[0].name).toBe("München Hbf");
  });

  it("keeps a second catalogue station at the same place apart from the first", () => {
    const labels = buildStationLabels(
      [
        ride({ depStationId: 1, depStationName: "Berlin Hbf" }),
        ride({ depStationId: 2, depStationName: "Berlin Hbf (tief)" }),
      ],
      RGB
    );
    expect(labels.filter((l) => l.name.startsWith("Berlin"))).toHaveLength(2);
  });

  it("leaves out cancelled rides, nameless stations and missing coordinates", () => {
    const labels = buildStationLabels(
      [ride({ status: "cancelled" }), ride({ depStationName: "  ", arrLat: Number.NaN })],
      RGB
    );
    expect(labels).toEqual([]);
  });

  it("counts a round trip from one station once per ride", () => {
    const labels = buildStationLabels(
      [ride({ arrStationName: "Berlin Hbf", arrLat: 52.525, arrLon: 13.369 })],
      RGB
    );
    expect(byName(labels)).toEqual({ "Berlin Hbf": 1 });
  });

  it("shortens long and shouty names for the label", () => {
    expect(toStationLabel("MUENCHEN HBF")).toBe("Muenchen Hbf");
    expect(toStationLabel("Frankfurt (Main) Flughafen Fernbahnhof").length).toBeLessThanOrEqual(20);
  });
});

/** Stations spread far apart, so only the budget — not the declutter — thins them. */
const spread = (n: number): StationLabelDatum[] =>
  Array.from({ length: n }, (_, i) =>
    datum({
      key: `s${i}`,
      position: [-170 + (i % 6) * 60, -60 + Math.floor(i / 6) * 20],
      count: i + 1,
    })
  );

describe("selectStationLabels", () => {
  it("shows the most-used stations first and more of them as the map zooms in", () => {
    const stations = spread(40);
    const world = selectStationLabels(stations, "important", 1);
    expect(world).toHaveLength(labelBudget(1));
    expect(world.map((s) => s.count)).toEqual([40, 39, 38, 37, 36]);
    expect(selectStationLabels(stations, "important", 3).length).toBeGreaterThan(world.length);
  });

  it("never lets two names sit on each other, keeping the busier one", () => {
    const close: StationLabelDatum[] = [
      datum({ key: "a", position: [13.369, 52.525], count: 1 }),
      datum({ key: "b", position: [13.375, 52.52], count: 9 }),
    ];
    expect(selectStationLabels(close, "important", 6).map((s) => s.key)).toEqual(["b"]);
    // Zoomed in far enough, the two are apart on screen and both show.
    expect(selectStationLabels(close, "important", 16)).toHaveLength(2);
  });

  it("keeps two long names apart by their width, not only their centres (Codex review)", () => {
    // 0.06 degrees apart: about 87 px at zoom 10 — clear of the shared 42 px
    // centre gap, but each name is about 100 px wide.
    const wide: StationLabelDatum[] = [
      datum({ key: "a", shortLabel: "Frankfurt Süd", position: [8.68, 50.1], count: 1 }),
      datum({ key: "b", shortLabel: "Frankfurt Ost", position: [8.74, 50.1], count: 9 }),
    ];
    expect(selectStationLabels(wide, "important", 10).map((s) => s.key)).toEqual(["b"]);
    expect(selectStationLabels(wide, "important", 13)).toHaveLength(2);
  });

  it("decides between domains in one pass: an interchange shows one name", () => {
    const rail = buildStationLabels([ride()], [1, 2, 3]);
    const bus = buildStationLabels([ride()], [4, 5, 6]);
    const shown = selectStationLabels([...rail, ...bus], "important", 8);
    expect(shown).toHaveLength(2);
  });

  it("labels two thousand rides in well under a frame budget", () => {
    const rides = Array.from({ length: 2000 }, (_, i) =>
      ride({
        depStationName: `Dep ${i}`,
        depLat: 45 + (i % 50) * 0.02,
        depLon: 5 + Math.floor(i / 50) * 0.02,
        arrStationName: `Arr ${i}`,
        arrLat: 45 + (i % 50) * 0.02 + 0.007,
        arrLon: 5 + Math.floor(i / 50) * 0.02 + 0.007,
      })
    );
    const started = performance.now();
    const stations = buildStationLabels(rides, [1, 2, 3]);
    for (const zoom of [2, 6, 10, 14]) selectStationLabels(stations, "important", zoom);
    selectStationLabels(stations, "all", 10);
    expect(stations).toHaveLength(4000);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("shows every name in 'all' and none in 'off'", () => {
    const close: StationLabelDatum[] = [
      datum({ key: "a", position: [13.369, 52.525], count: 1 }),
      datum({ key: "b", position: [13.375, 52.52], count: 9 }),
    ];
    expect(selectStationLabels(close, "all", 2)).toHaveLength(2);
    expect(selectStationLabels(close, "off", 12)).toEqual([]);
  });

  it("snaps the zoom to an integer, as the map does for the airport labels", () => {
    expect(snapLabelZoom(4.4)).toBe(4);
    expect(snapLabelZoom(4.6)).toBe(5);
  });
});

type TextProps = {
  id: string;
  data: StationLabelDatum[];
  getBorderColor: (d: StationLabelDatum) => number[];
  getText: (d: StationLabelDatum) => string;
  characterSet: unknown;
};

/** Runs the layer's own update at a zoom without a WebGL context. */
function render(layer: StationLabelsLayer, zoom: number): TextProps {
  Object.assign(layer, {
    context: { viewport: { zoom } },
    state: {},
    setState(this: StationLabelsLayer, patch: object) {
      Object.assign(this.state, patch);
    },
  });
  layer.updateState();
  const [text] = layer.renderLayers() as Layer[];
  return text.props as unknown as TextProps;
}

describe("StationLabelsLayer", () => {
  const data = buildStationLabels([ride()], RGB);

  it("paints each border in its own domain's colour, never one of its own", () => {
    const mixed = [
      ...buildStationLabels([ride()], [1, 2, 3]),
      ...buildStationLabels([ride({ depLat: 10, arrLat: 20 })], [200, 100, 50]),
    ];
    const props = render(new StationLabelsLayer({ id: "t", data: mixed, labelsMode: "all" }), 5);
    expect(props.data.map(props.getBorderColor)).toEqual([
      [1, 2, 3, 200],
      [1, 2, 3, 200],
      [200, 100, 50, 200],
      [200, 100, 50, 200],
    ]);
  });

  it("labels with the stored names and keeps umlauts renderable", () => {
    const props = render(new StationLabelsLayer({ id: "t", data, labelsMode: "all" }), 5);
    expect(props.data.map(props.getText).sort()).toEqual(["Berlin Hbf", "Hamburg Hbf"]);
    expect(props.characterSet).toBe("auto");
  });

  it("re-picks on a zoom step and not on a pan", () => {
    const layer = new StationLabelsLayer({
      id: "t",
      data: spread(40),
      labelsMode: "important",
    });
    const world = render(layer, 1);
    expect(world.data).toHaveLength(labelBudget(1));
    const flags = (viewportChanged: boolean) => ({
      changeFlags: { propsOrDataChanged: false, viewportChanged },
    });
    const ask = (zoom: number, viewportChanged: boolean) => {
      Object.assign(layer, { context: { viewport: { zoom } } });
      return layer.shouldUpdateState(flags(viewportChanged) as never);
    };
    expect(ask(1.3, true)).toBe(false);
    expect(ask(2.6, true)).toBe(true);
    expect(ask(2.6, false)).toBe(false);
  });
});

describe("buildStationLabelLayers", () => {
  it("builds one label layer under the domain's id", () => {
    const [layer] = buildStationLabelLayers([{ rides: [ride()], color: RGB }], {
      labelsMode: "important",
      idPrefix: "all-rail",
    });
    expect(layer.id).toBe("all-rail-station-labels");
  });

  it("builds nothing without rides or with labels off", () => {
    const opts = { idPrefix: "x" };
    const one = [{ rides: [ride()], color: RGB }];
    expect(buildStationLabelLayers([], { ...opts, labelsMode: "all" })).toEqual([]);
    expect(buildStationLabelLayers(one, { ...opts, labelsMode: "off" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";

import { buildRailMapLayers } from "../railMapOverlay";
import { buildRentalLegendRows, buildRentalMapLayers } from "../rentalMapOverlay";
import { buildTourDeckLayers, TOUR_LINE_WIDTH_PX } from "../tourMapOverlay";
import {
  RAIL_LINE_WIDTH_PX,
  RAIL_STATION_RADIUS_PX,
  type RailPathDatum,
  type RailPathSource,
} from "../../../layers/railPathsLayer";
import {
  RENTAL_LINK_WIDTH_PX,
  RENTAL_RADIUS_PX,
  type RentalMapSource,
  type RentalPointDatum,
} from "../../../layers/rentalLayer";
import { buildRoadtripStationLayers } from "../../../layers/roadtripStationsLayer";
import { MARKER_DOT_MAX_PX, MARKER_DOT_MIN_PX } from "../../../layers/markerDotStyle";
import type { TourPathDatum } from "../../../layers/tourPathsLayer";
import { allTabAppearanceDomains } from "../useAllTabDomainVisibility";

/**
 * forgejo#198: the map panel's new tour, roadtrip, rail and rental sliders.
 * Each case reads the props deck.gl would actually be given — a slider that
 * reaches the store but not the layer is exactly the defect this guards.
 */

type Props = Record<string, unknown>;
const propsOf = (layer: Layer): Props => layer.props as unknown as Props;
const byId = (layers: Layer[], suffix: string): Layer | undefined =>
  layers.find((l) => l.id.endsWith(suffix));

const RIDE: RailPathSource = {
  id: "j1",
  depStationName: "Frankfurt",
  arrStationName: "Fulda",
  depLat: 50.1,
  depLon: 8.66,
  arrLat: 50.55,
  arrLon: 9.68,
  geometry: [
    [8.66, 50.1],
    [9.68, 50.55],
  ],
  geometrySource: "transitous",
  status: "completed",
} as RailPathSource;

describe("rail: line width and station size reach the layers", () => {
  const widthOf = (layers: Layer[]): number => {
    const getWidth = propsOf(byId(layers, "-paths")!).getWidth as (d: RailPathDatum) => number;
    return getWidth({ traced: true } as RailPathDatum);
  };

  it("draws today's widths and dots without a style", () => {
    const layers = buildRailMapLayers([RIDE], "#112233", false);
    expect(widthOf(layers)).toBe(RAIL_LINE_WIDTH_PX.traced);
    expect(propsOf(byId(layers, "-stations")!).getRadius).toBe(RAIL_STATION_RADIUS_PX);
  });

  it("scales the line and the station dots by the panel's multipliers", () => {
    const layers = buildRailMapLayers([RIDE], "#112233", false, "t", {
      lineWidth: 2,
      stationSize: 1.5,
    });
    expect(widthOf(layers)).toBe(RAIL_LINE_WIDTH_PX.traced * 2);
    expect(propsOf(byId(layers, "-stations")!).getRadius).toBe(RAIL_STATION_RADIUS_PX * 1.5);
  });

  it("lets a thin line be thin: the pixel floor does not undo the slider", () => {
    const layers = buildRailMapLayers([RIDE], "#112233", false, "t", {
      lineWidth: 0.3,
      stationSize: 1,
    });
    expect(propsOf(byId(layers, "-paths")!).widthMinPixels).toBeLessThanOrEqual(
      RAIL_LINE_WIDTH_PX.chord * 0.5
    );
  });

  it("draws no station layer at size 0", () => {
    const layers = buildRailMapLayers([RIDE], "#112233", false, "t", {
      lineWidth: 1,
      stationSize: 0,
    });
    expect(byId(layers, "-stations")).toBeUndefined();
    expect(byId(layers, "-paths")).toBeDefined();
  });
});

const ONE_WAY: RentalMapSource = {
  id: "r1",
  provider: "Testcar",
  pickupStationName: "A",
  returnStationName: "B",
  pickupLat: 50,
  pickupLon: 8,
  returnLat: 48,
  returnLon: 11,
  oneWay: true,
  routeId: null,
  status: "completed",
};

const legendKeys = (rows: JSX.Element[]): unknown[] => rows.map((r) => r.key);
const fakeRow = (_bg: string, _label: string, key: string): JSX.Element =>
  ({ key }) as unknown as JSX.Element;
const t = (key: string): string => key;

describe("rental: width, marker size and the line switch reach layer and legend", () => {
  const linkData = (layers: Layer[]): unknown[] =>
    propsOf(byId(layers, "-links")!).data as unknown[];

  it("draws the dashed link and both stations by default", () => {
    const layers = buildRentalMapLayers([ONE_WAY], "#112233", false);
    expect(linkData(layers)).toHaveLength(1);
    expect(propsOf(byId(layers, "-links")!).getWidth).toBe(RENTAL_LINK_WIDTH_PX);
    expect(byId(layers, "-points")).toBeDefined();
  });

  it("with the line switched off draws the stations only, and the key drops the link row", () => {
    const style = { lineWidth: 1, markerSize: 1, showLine: false };
    const layers = buildRentalMapLayers([ONE_WAY], "#112233", false, "t", style);
    expect(linkData(layers)).toHaveLength(0);
    const points = propsOf(byId(layers, "-points")!).data as RentalPointDatum[];
    expect(points.map((p) => p.role)).toEqual(["pickup", "return"]);
    const keys = legendKeys(buildRentalLegendRows([ONE_WAY], "#112233", t, fakeRow, style));
    expect(keys).toContain("rental-ends");
    expect(keys).not.toContain("rental-oneway");
  });

  it("scales the link width and the marker radii", () => {
    const layers = buildRentalMapLayers([ONE_WAY], "#112233", false, "t", {
      lineWidth: 1.5,
      markerSize: 0.5,
      showLine: true,
    });
    expect(propsOf(byId(layers, "-links")!).getWidth).toBe(RENTAL_LINK_WIDTH_PX * 1.5);
    const getRadius = propsOf(byId(layers, "-points")!).getRadius as (
      d: RentalPointDatum
    ) => number;
    expect(getRadius({ role: "return" } as RentalPointDatum)).toBe(RENTAL_RADIUS_PX.end * 0.5);
  });

  it("draws no marker layer at size 0, and the key names no station", () => {
    const style = { lineWidth: 1, markerSize: 0, showLine: true };
    const layers = buildRentalMapLayers([ONE_WAY], "#112233", false, "t", style);
    expect(byId(layers, "-points")).toBeUndefined();
    const keys = legendKeys(buildRentalLegendRows([ONE_WAY], "#112233", t, fakeRow, style));
    expect(keys).toEqual(["rental-oneway"]);
  });
});

describe("tours and roadtrips: each kind follows its own width slider", () => {
  const datum = (isRoadtrip: boolean, isPlaceholder = false): TourPathDatum => ({
    legId: "l",
    path: [
      [8, 58],
      [5, 60],
    ],
    color: [1, 2, 3],
    isPlaceholder,
    isRoadtrip,
    label: "x",
  });
  const widthOf = (d: TourPathDatum, scales?: { tour: number; roadtrip: number }): number => {
    const [layer] = buildTourDeckLayers([d], 0, scales);
    return (propsOf(layer).getWidth as (x: TourPathDatum) => number)(d);
  };

  it("scales a day tour by the tour slider and a roadtrip by the roadtrip slider", () => {
    const scales = { tour: 0.5, roadtrip: 2 };
    expect(widthOf(datum(false), scales)).toBe(TOUR_LINE_WIDTH_PX.tour * 0.5);
    expect(widthOf(datum(true), scales)).toBe(TOUR_LINE_WIDTH_PX.roadtrip * 2);
  });

  it("scales a roadtrip's placeholder chord by the roadtrip slider", () => {
    expect(widthOf(datum(true, true), { tour: 1, roadtrip: 1.5 })).toBe(
      TOUR_LINE_WIDTH_PX.placeholder * 1.5
    );
  });

  it("keeps today's widths without scales", () => {
    expect(widthOf(datum(false))).toBe(TOUR_LINE_WIDTH_PX.tour);
    expect(widthOf(datum(true))).toBe(TOUR_LINE_WIDTH_PX.roadtrip);
  });
});

describe("roadtrip stations: the size slider reaches the dots", () => {
  const station = {
    id: "s",
    title: "Bergen",
    lat: 60.4,
    lon: 5.3,
    state: "stay" as const,
    roadtripName: "Norway",
  };
  const colors = { stay: [1, 1, 1], free: [2, 2, 2], pass: [3, 3, 3] } as Parameters<
    typeof buildRoadtripStationLayers
  >[1];

  it("scales the dot's pixel clamp by the size", () => {
    const [layer] = buildRoadtripStationLayers([station], colors, 0, 1.5);
    expect(propsOf(layer).radiusMinPixels).toBe(MARKER_DOT_MIN_PX * 1.5);
    expect(propsOf(layer).radiusMaxPixels).toBe(MARKER_DOT_MAX_PX * 1.5);
  });

  it("draws nothing at size 0", () => {
    expect(buildRoadtripStationLayers([station], colors, 0, 0)).toEqual([]);
  });
});

describe("allTabAppearanceDomains", () => {
  it("offers the overlay sections only while the overview map draws those layers", () => {
    expect(allTabAppearanceDomains(true)).toEqual([
      "flight",
      "cruise",
      "lodging",
      "poi",
      "tour",
      "roadtrip",
      "rail",
      "rental",
    ]);
    expect(allTabAppearanceDomains(false)).toEqual(["flight", "cruise", "lodging", "poi"]);
  });

  it("never offers the roadtrip station slider: the Alle map draws no stations", () => {
    expect(allTabAppearanceDomains(true)).not.toContain("roadtripStations");
  });
});

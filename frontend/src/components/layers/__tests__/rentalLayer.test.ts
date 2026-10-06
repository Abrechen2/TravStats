import { describe, expect, it } from "vitest";
import {
  buildRentalDeckLayers,
  buildRentalLinks,
  buildRentalPoints,
  RENTAL_LINK_DASH,
  RENTAL_RADIUS_PX,
} from "../rentalLayer";
import type { RentalMapSource, RentalPointDatum } from "../rentalLayer";
import { buildRailDeckLayers, type RailPathDatum, type RailStationDatum } from "../railPathsLayer";
import { STATION_DOT_RADIUS_PX } from "../markerDotStyle";

const base: RentalMapSource = {
  id: "r1",
  provider: "Testcar",
  pickupStationName: "A",
  returnStationName: "A",
  pickupLat: 50,
  pickupLon: 8,
  returnLat: 50,
  returnLon: 8,
  oneWay: false,
  routeId: null,
  status: "completed",
};

/** What a rental draws (rental spec §6, D1 a) — two places, never a route. */
describe("rentalLayer", () => {
  it("draws a same-station rental as ONE point and no line", () => {
    expect(buildRentalPoints([base]).map((p) => p.role)).toEqual(["same"]);
    expect(buildRentalLinks([base])).toEqual([]);
  });

  it("draws a one-way rental as a hollow pickup, a filled return and a dashed link", () => {
    const oneWay = { ...base, oneWay: true, returnStationName: "B", returnLat: 48, returnLon: 11 };
    expect(buildRentalPoints([oneWay]).map((p) => p.role)).toEqual(["pickup", "return"]);
    const links = buildRentalLinks([oneWay]);
    expect(links).toHaveLength(1);
    const [linkLayer] = buildRentalDeckLayers(buildRentalPoints([oneWay]), links, {
      color: [1, 2, 3],
    });
    expect((linkLayer.props as unknown as { getDashArray: number[] }).getDashArray).toEqual(
      RENTAL_LINK_DASH
    );
  });

  it("leaves the line to the roadtrip a rental belongs to — badges only", () => {
    const onRoadtrip = { ...base, oneWay: true, routeId: "rt", returnLat: 48, returnLon: 11 };
    expect(buildRentalLinks([onRoadtrip])).toEqual([]);
    expect(buildRentalPoints([onRoadtrip])).toHaveLength(2);
  });

  it("draws nothing for a cancelled rental", () => {
    const cancelled = { ...base, status: "cancelled" as const };
    expect(buildRentalPoints([cancelled])).toEqual([]);
  });

  it("takes its colour from the caller — the domain colour store — for points and link alike", () => {
    const oneWay = { ...base, oneWay: true, returnLat: 48, returnLon: 11 };
    const [link, points] = buildRentalDeckLayers(
      buildRentalPoints([oneWay]),
      buildRentalLinks([oneWay]),
      {
        color: [10, 20, 30],
      }
    );
    expect((link.props as unknown as { getColor: number[] }).getColor.slice(0, 3)).toEqual([
      10, 20, 30,
    ]);
    const getLineColor = (points.props as unknown as { getLineColor: Accessor }).getLineColor;
    expect(getLineColor(buildRentalPoints([oneWay])[0]).slice(0, 3)).toEqual([10, 20, 30]);
  });
});

type Accessor = (d: RentalPointDatum) => number[];
type Resolved = (d: unknown) => unknown;

/** A prop as one datum sees it — deck.gl takes a constant or an accessor alike. */
function resolve(props: Record<string, unknown>, key: string, datum: unknown): unknown {
  const value = props[key];
  return typeof value === "function" ? (value as Resolved)(datum) : value;
}

/**
 * forgejo#208: a rental returned where it was picked up is an ordinary station
 * dot, in the rental colour — not the ring around a translucent dot it was.
 * "The same dot" is checked against the rail station dot itself, so the two
 * cannot drift apart.
 */
describe("rentalLayer — the same-station dot", () => {
  const COLOR: [number, number, number] = [10, 20, 30];
  const STYLE_KEYS = [
    "getRadius",
    "radiusUnits",
    "getFillColor",
    "getLineColor",
    "getLineWidth",
    "lineWidthUnits",
    "stroked",
    "filled",
  ];

  it("draws exactly the rail station dot, in the colour it was given", () => {
    const [, rentalPoints] = buildRentalDeckLayers(buildRentalPoints([base]), [], {
      color: COLOR,
    });
    const station: RailStationDatum = { key: "s", position: [8, 50], name: "A" };
    const path: RailPathDatum = {
      id: "p",
      path: [
        [8, 50],
        [9, 51],
      ],
      traced: false,
      source: "straight",
      label: "A → B",
    };
    const [, railStations] = buildRailDeckLayers([path], [station], { color: COLOR });
    const same = buildRentalPoints([base])[0];
    const rental = rentalPoints.props as unknown as Record<string, unknown>;
    const rail = railStations.props as unknown as Record<string, unknown>;
    for (const key of STYLE_KEYS) {
      expect({ key, value: resolve(rental, key, same) }).toEqual({
        key,
        value: resolve(rail, key, station),
      });
    }
    expect(resolve(rental, "getFillColor", same)).toEqual([...COLOR, 255]);
    expect(resolve(rental, "getRadius", same)).toBe(STATION_DOT_RADIUS_PX);
  });

  it("follows the station-size slider like the rail dot does", () => {
    const [, rentalPoints] = buildRentalDeckLayers(buildRentalPoints([base]), [], {
      color: COLOR,
      markerSize: 1.5,
    });
    const rental = rentalPoints.props as unknown as Record<string, unknown>;
    expect(resolve(rental, "getRadius", buildRentalPoints([base])[0])).toBe(
      STATION_DOT_RADIUS_PX * 1.5
    );
  });

  it("keeps a one-way rental's direction: a hollow pickup ring, a filled return", () => {
    const oneWay = { ...base, oneWay: true, returnLat: 48, returnLon: 11 };
    const [pickup, ret] = buildRentalPoints([oneWay]);
    const [, layer] = buildRentalDeckLayers([pickup, ret], [], { color: COLOR });
    const props = layer.props as unknown as Record<string, unknown>;
    expect(resolve(props, "getFillColor", pickup)).toEqual([0, 0, 0, 0]);
    expect(resolve(props, "getFillColor", ret)).toEqual([...COLOR, 255]);
    expect(resolve(props, "getLineColor", pickup)).toEqual([...COLOR, 255]);
    expect(resolve(props, "getRadius", pickup)).toBe(RENTAL_RADIUS_PX.end);
  });
});

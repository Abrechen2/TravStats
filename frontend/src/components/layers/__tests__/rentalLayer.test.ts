import { describe, expect, it } from "vitest";
import {
  buildRentalDeckLayers,
  buildRentalLinks,
  buildRentalPoints,
  RENTAL_LINK_DASH,
} from "../rentalLayer";
import type { RentalMapSource } from "../rentalLayer";

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
    expect(
      (points.props as unknown as { getLineColor: number[] }).getLineColor.slice(0, 3)
    ).toEqual([10, 20, 30]);
  });
});

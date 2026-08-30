import { describe, expect, it } from "vitest";

import { buildTourPaths, TOUR_MODE_RGB, UNKNOWN_MODE_RGB } from "../tourPathsLayer";
import type { LegMode, TourGeometry } from "../../../types/tour";

const geo = (mode: "road" | "ferry", source: "straight" | "drawn"): TourGeometry => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [8, 58],
          [5.3, 60.4],
        ],
      },
      properties: { legId: "l1", source, mode, confidence: "low", distanceKm: 300 },
    },
  ],
});

describe("buildTourPaths", () => {
  it("colours a leg by its own mode, not the section's", () => {
    const [road] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "drawn") }]);
    const [ferry] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("ferry", "drawn") }]);
    expect(road.color).toEqual(TOUR_MODE_RGB.road);
    expect(ferry.color).toEqual(TOUR_MODE_RGB.ferry);
  });

  it("marks a straight leg as a placeholder so it renders lighter, not measured", () => {
    const [straight] = buildTourPaths([
      { routeId: "r1", name: "S", geometry: geo("road", "straight") },
    ]);
    const [drawn] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "drawn") }]);
    expect(straight.isPlaceholder).toBe(true);
    expect(drawn.isPlaceholder).toBe(false);
  });

  it("falls back to neutral grey for an unrecognised mode, never road's colour", () => {
    const unknownMode: TourGeometry = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [8, 58],
              [5.3, 60.4],
            ],
          },
          properties: {
            legId: "l1",
            source: "drawn",
            mode: "gondola" as unknown as LegMode,
            confidence: "low",
            distanceKm: 10,
          },
        },
      ],
    };
    const [leg] = buildTourPaths([{ routeId: "r1", name: "S", geometry: unknownMode }]);
    expect(leg.color).toEqual(UNKNOWN_MODE_RGB);
    expect(leg.color).not.toEqual(TOUR_MODE_RGB.road);
  });

  it("drops a feature with fewer than two coordinates instead of crashing", () => {
    const broken: TourGeometry = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[8, 58]] },
          properties: {
            legId: "l1",
            source: "straight",
            mode: "road",
            confidence: "low",
            distanceKm: 0,
          },
        },
      ],
    };
    expect(buildTourPaths([{ routeId: "r1", name: "S", geometry: broken }])).toEqual([]);
  });

  it("returns nothing for an empty collection", () => {
    expect(
      buildTourPaths([
        { routeId: "r1", name: "S", geometry: { type: "FeatureCollection", features: [] } },
      ])
    ).toEqual([]);
  });
});

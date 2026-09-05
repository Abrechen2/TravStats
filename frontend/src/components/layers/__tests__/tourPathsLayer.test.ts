import { describe, expect, it } from "vitest";

import { buildTourPaths, TOUR_RGB } from "../tourPathsLayer";
import { TOUR_COLOR } from "../../../shared/domains";
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
  it("gives every leg the one tour colour, whatever the mode", () => {
    // Until 2026-09-05 a leg was coloured by its own mode — five colours, and
    // a comment arguing that a hue is a claim about how a leg was travelled.
    // The owner settled it the other way: one domain, one colour, and the
    // means of transport is carried by the icon.
    const [road] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "drawn") }]);
    const [ferry] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("ferry", "drawn") }]);
    expect(road.color).toEqual(TOUR_RGB);
    expect(ferry.color).toEqual(road.color);
  });

  it("derives that colour from the registry rather than repeating a literal", () => {
    const n = parseInt(TOUR_COLOR.slice(1), 16);
    expect(TOUR_RGB).toEqual([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
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
    // An unrecognised mode used to need a neutral grey so it could not borrow
    // road's green and claim a van made the trip. With one colour there is no
    // claim left to make wrongly — the leg is a tour leg, and that is all the
    // colour ever says now.
    expect(leg.color).toEqual(TOUR_RGB);
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

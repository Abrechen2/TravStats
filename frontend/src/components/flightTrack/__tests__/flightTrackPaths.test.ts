import { describe, expect, it } from "vitest";

import { flightTrackBounds, flightTrackPaths } from "../flightTrackPaths";

describe("flightTrackPaths", () => {
  it("splits the line where the phone lost its fix, and draws nothing across the gap", () => {
    const paths = flightTrackPaths(
      [
        [8, 50],
        [9, 50],
        [20, 48],
        [21, 48],
      ],
      [0, 2]
    );
    expect(paths).toEqual([
      [
        [8, 50],
        [9, 50],
      ],
      [
        [20, 48],
        [21, 48],
      ],
    ]);
  });

  it("keeps a flight across the date line in one piece", () => {
    const [path] = flightTrackPaths(
      [
        [178, 40],
        [-179, 41],
        [-176, 42],
      ],
      [0]
    );
    expect(path.map((p) => p[0])).toEqual([178, 181, 184]);
  });

  it("drops a one-point stretch, which is no line", () => {
    const paths = flightTrackPaths(
      [
        [8, 50],
        [9, 50],
        [30, 40],
      ],
      [0, 2]
    );
    expect(paths).toHaveLength(1);
  });
});

describe("flightTrackBounds", () => {
  it("frames every drawn point with a margin", () => {
    expect(
      flightTrackBounds([
        [
          [8, 50],
          [10, 48],
        ],
      ])
    ).toEqual([
      [7.5, 47.5],
      [10.5, 50.5],
    ]);
  });

  it("says null for nothing to frame", () => {
    expect(flightTrackBounds([])).toBeNull();
  });
});

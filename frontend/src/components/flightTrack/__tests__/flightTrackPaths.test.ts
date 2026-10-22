import { describe, expect, it } from "vitest";

import { allTrackLines, flightTrackBounds, flightTrackPieces } from "../flightTrackPaths";
import { flightTrackGreatCircle } from "../flightTrackGreatCircle";

type LonLat = [number, number];

/** `n` fixes walking east along 50° N, one degree apart. */
const walk = (n: number, fromLon = 0): LonLat[] =>
  Array.from({ length: n }, (_, i): LonLat => [fromLon + i, 50]);

const key = ([lon, lat]: LonLat): string => `${lon},${lat}`;

describe("flightTrackPieces", () => {
  it("draws measured stretches solid and the step across a hole as a connector", () => {
    const pieces = flightTrackPieces(
      [
        [8, 50],
        [9, 50],
        [20, 48],
        [21, 48],
      ],
      [0, 2]
    );
    expect(pieces.solid).toEqual([
      [
        [8, 50],
        [9, 50],
      ],
      [
        [20, 48],
        [21, 48],
      ],
    ]);
    // End of stretch one to the start of stretch two — a straight step, no invented curve.
    expect(pieces.gaps).toEqual([
      [
        [9, 50],
        [20, 48],
      ],
    ]);
  });

  it("keeps a one-fix stretch on the drawing instead of dropping it", () => {
    const pieces = flightTrackPieces(
      [
        [8, 50],
        [9, 50],
        [30, 40],
      ],
      [0, 2]
    );
    expect(pieces.solid).toEqual([
      [
        [8, 50],
        [9, 50],
      ],
    ]);
    expect(pieces.gaps).toEqual([
      [
        [9, 50],
        [30, 40],
      ],
    ]);
  });

  it("draws LH719's shape — 24 lone fixes, then two stretches — as one line, every fix kept", () => {
    // Measured on prod (22.10.): segmentStarts [0, 1, …, 24, 93] over 183 vertices.
    const geometry = walk(183);
    const starts = [...Array.from({ length: 25 }, (_, i) => i), 93];
    const pieces = flightTrackPieces(geometry, starts);

    // Two measured stretches: 24..92 and 93..182.
    expect(pieces.solid.map((s) => [s[0][0], s[s.length - 1][0]])).toEqual([
      [24, 92],
      [93, 182],
    ]);
    // The lone fixes 0..23 run on as ONE dashed connector into fix 24; then
    // the hole between 92 and 93.
    expect(pieces.gaps.map((g) => g.map((p) => p[0]))).toEqual([
      Array.from({ length: 25 }, (_, i) => i),
      [92, 93],
    ]);
    // Nothing the receiver measured is missing from the drawing.
    const drawn = new Set(allTrackLines(pieces).flat().map(key));
    expect(geometry.every((p) => drawn.has(key(p)))).toBe(true);
  });

  it("joins the line from the first fix to the last, holes included", () => {
    // LH718's shape: [0, 1, 47, 48, 49, 94, 95, 97, 98] with stretches between.
    const geometry = walk(130);
    const pieces = flightTrackPieces(geometry, [0, 1, 47, 48, 49, 94, 95, 97, 98]);
    const lines = allTrackLines(pieces);
    const ends = new Map<string, number>();
    for (const l of lines) {
      for (const p of [l[0], l[l.length - 1]]) ends.set(key(p), (ends.get(key(p)) ?? 0) + 1);
    }
    // A continuous chain has exactly two loose ends: the first and the last fix.
    const loose = [...ends].filter(([, n]) => n % 2 === 1).map(([k]) => k);
    expect(loose.sort()).toEqual([key(geometry[0]), key(geometry[129])].sort());
  });

  it("keeps a flight across the date line in one piece, through a hole too", () => {
    const pieces = flightTrackPieces(
      [
        [178, 40],
        [179, 40.5],
        [-179, 41],
        [-176, 42],
      ],
      [0, 2]
    );
    expect(pieces.solid.map((s) => s.map((p) => p[0]))).toEqual([
      [178, 179],
      [181, 184],
    ]);
    expect(pieces.gaps[0].map((p) => p[0])).toEqual([179, 181]);
  });

  it("has no connector for a recording without holes", () => {
    expect(flightTrackPieces(walk(3), [0]).gaps).toEqual([]);
  });
});

describe("flightTrackGreatCircle", () => {
  it("runs from airport to airport", () => {
    const line = flightTrackGreatCircle(
      { lat: 48.35, lon: 11.79 },
      { lat: 37.46, lon: 126.44 },
      [11.79, 48.35]
    );
    expect(line?.[0]).toEqual([11.79, 48.35]);
    expect(line?.[line.length - 1]).toEqual([126.44, 37.46]);
  });

  it("lands in the recording's world copy", () => {
    // A recording that starts unwrapped at 181° E (−179°): the circle follows it.
    const line = flightTrackGreatCircle({ lat: 40, lon: -179 }, { lat: 42, lon: -170 }, [181, 40]);
    expect(line?.[0][0]).toBe(181);
  });

  it("says null without a position — an unknown airport is stored as 0,0", () => {
    expect(flightTrackGreatCircle({ lat: 0, lon: 0 }, { lat: 37, lon: 126 }, [0, 0])).toBeNull();
    expect(flightTrackGreatCircle(null, { lat: 37, lon: 126 }, [0, 0])).toBeNull();
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

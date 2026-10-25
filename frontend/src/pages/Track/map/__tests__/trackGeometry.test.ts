import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import {
  distanceM,
  rangeTotals,
  speedColor,
  speedPieces,
  splitAfterPause,
  SPEED_STOPS,
} from "../trackGeometry";

/**
 * The Track map's arithmetic (plan T5.2) stays inside one stretch: no speed,
 * piece or metre between two stretches, and the client split only cuts.
 */

const MIN = 60_000;
const T0 = Date.parse("2026-10-25T06:00:00Z");
const p = (min: number, lat: number, lon: number): TrackPoint => [T0 + min * MIN, lat, lon, 5];

// Two stretches far apart: Berlin, then — after a break — Munich.
const BERLIN = [p(0, 52.52, 13.4), p(1, 52.521, 13.401), p(2, 52.522, 13.402)];
const MUNICH = [p(60, 48.137, 11.575), p(61, 48.138, 11.576)];

const pairsOf = (segments: TrackPoint[][]) =>
  segments.flatMap((s) => s.slice(1).map((q, i) => `${s[i][0]}>${q[0]}`));

describe("speedPieces", () => {
  it("never spans a segment break", () => {
    const pieces = speedPieces([BERLIN, MUNICH]);
    expect(pieces).toHaveLength(3); // 2 in Berlin + 1 in Munich, none Berlin→Munich
    for (const piece of pieces) {
      const [[lon1], [lon2]] = piece.path;
      expect(Math.abs(lon1 - lon2)).toBeLessThan(0.01);
    }
    expect(pieces.map((x) => x.segment)).toEqual([0, 0, 1]);
  });

  it("speed comes from the two neighbouring fixes; a shared instant has none", () => {
    const [piece] = speedPieces([[p(0, 52.52, 13.4), p(1, 52.53, 13.4)]]);
    expect(piece.kmh).toBeCloseTo((distanceM(BERLIN[0], [0, 52.53, 13.4, 5]) / 60_000) * 3600, 3);
    const [same] = speedPieces([[p(0, 52.52, 13.4), p(0, 52.53, 13.4)]]);
    expect(same.kmh).toBeNull();
  });

  it("colours along the legend's ramp", () => {
    expect(speedColor(0)).toEqual(SPEED_STOPS[0].rgb);
    expect(speedColor(1000)).toEqual(SPEED_STOPS[3].rgb);
    expect(speedColor(null)).toEqual([148, 163, 184]);
  });
});

describe("splitAfterPause", () => {
  const withPause = [p(0, 1, 1), p(1, 1, 1.001), p(50, 1, 1.002), p(51, 1, 1.003)];

  it("cuts where the pause is longer than the setting", () => {
    expect(splitAfterPause([withPause], 30 * MIN)).toHaveLength(2);
    expect(splitAfterPause([withPause], 60 * MIN)).toHaveLength(1);
    expect(splitAfterPause([withPause], null)).toHaveLength(1);
  });

  it("only splits, never joins: every pair it keeps was already a pair", () => {
    const input = [BERLIN, MUNICH, withPause];
    for (const pause of [null, 1, 5, 30, 120].map((m) => (m === null ? null : m * MIN))) {
      const out = splitAfterPause(input, pause);
      expect(out.length).toBeGreaterThanOrEqual(input.length);
      const before = new Set(pairsOf(input));
      for (const pair of pairsOf(out)) expect(before.has(pair)).toBe(true);
      expect(out.flat()).toHaveLength(input.flat().length);
    }
  });
});

describe("rangeTotals", () => {
  it("sums distance inside stretches only, and reports no average over nothing", () => {
    const totals = rangeTotals(
      [BERLIN, MUNICH],
      [
        {
          pointCount: 5,
          coverage: [
            { fromMs: 0, untilMs: 75, state: "recorded" },
            { fromMs: 75, untilMs: 100, state: "noData" },
          ],
        },
      ]
    );
    const inside =
      distanceM(BERLIN[0], BERLIN[1]) +
      distanceM(BERLIN[1], BERLIN[2]) +
      distanceM(MUNICH[0], MUNICH[1]);
    expect(totals.distanceM).toBeCloseTo(inside, 6);
    expect(totals.distanceM).toBeLessThan(1_000); // Berlin→Munich (~500 km) is not in it
    expect(totals.points).toBe(5);
    expect(totals.coverage).toBeCloseTo(0.75);

    const still = rangeTotals([[p(0, 1, 1), p(10, 1, 1)]], []);
    expect(still.avgKmh).toBeNull();
    expect(still.movingMs).toBe(0);
    expect(still.coverage).toBeNull();
  });
});

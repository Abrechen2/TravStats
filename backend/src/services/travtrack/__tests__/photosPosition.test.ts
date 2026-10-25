import type { StoredPoint } from "../../tripRecording/segments";
import { positionAt } from "../photos";

/**
 * Where a photo sits on the track (TravTrack plan T5.3): between two
 * consecutive vertices of ONE stretch, never across two, and never at a
 * place inside a privacy circle — the interpolated position is checked again.
 */

const T = Date.parse("2026-10-10T12:00:00Z");
const MIN = 60_000;
const west: StoredPoint = [T, 37.5, 127.0, 5];
const east: StoredPoint = [T + 10 * MIN, 37.5, 127.02, 5];
const later: StoredPoint = [T + 60 * MIN, 37.6, 127.1, 5];
const farther: StoredPoint = [T + 70 * MIN, 37.6, 127.12, 5];

describe("positionAt", () => {
  it("interpolates by time inside a stretch, and hits a vertex exactly", () => {
    const mid = positionAt([[west, east]], [], T + 5 * MIN);
    expect(mid!.lat).toBeCloseTo(37.5, 9);
    expect(mid!.lon).toBeCloseTo(127.01, 9);
    expect(positionAt([[west, east]], [], T)).toEqual({ lat: 37.5, lon: 127.0 });
  });

  it("never bridges two stretches, nor reaches beyond their ends", () => {
    const stretches = [
      [west, east],
      [later, farther],
    ];
    expect(positionAt(stretches, [], T + 30 * MIN)).toBeNull();
    expect(positionAt(stretches, [], T - MIN)).toBeNull();
    expect(positionAt(stretches, [], T + 71 * MIN)).toBeNull();
  });

  it("gives no position inside a circle, even on a chord handed to it", () => {
    const circle = { lat: 37.5, lon: 127.01, radiusM: 300 };
    expect(positionAt([[west, east]], [circle], T + 5 * MIN)).toBeNull();
    expect(positionAt([[west, east]], [circle], T + MIN)).not.toBeNull();
  });

  it("takes the short way across the antimeridian", () => {
    const a: StoredPoint = [T, 0, 179.9, 5];
    const b: StoredPoint = [T + 2 * MIN, 0, -179.9, 5];
    const p = positionAt([[a, b]], [], T + MIN);
    expect(Math.abs(p!.lon)).toBeCloseTo(180, 6);
  });
});

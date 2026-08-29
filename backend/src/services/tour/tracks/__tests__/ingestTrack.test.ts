import { describe, it, expect } from "@jest/globals";

import { ingestTrack } from "../ingestTrack";
import { polylineDistanceKm } from "../../../cruiseDistance/polylineDistance";
import type { ParsedTrack } from "../parseGpx";

/**
 * Task 3 (Phase 3b tour tracks): the ingestion step between `parseGpx`
 * (task 2) and the database. Pure — no file system, no database, no network.
 *
 * The test that matters most is case 1: distance must be measured on the RAW
 * points, BEFORE simplification. Simplifying first and measuring after
 * silently shortens every track, and the entire reason this feature exists
 * is that a track's distance is *measured* rather than estimated.
 */

const START = new Date("2026-06-01T08:00:00Z");

function withTimestamps(points: Array<[number, number]>): ParsedTrack {
  const startedAt = new Date(START.getTime());
  const endedAt = new Date(START.getTime() + (points.length - 1) * 1000);
  return { points, startedAt, endedAt, name: "Test Track" };
}

/**
 * A track that steadily gains latitude while oscillating a small amount in
 * longitude around the straight line — real distance (many short zigzag
 * segments) is strictly greater than the straight-line distance between its
 * endpoints once the oscillation is simplified away.
 */
function buildZigZagTrack(count: number, amplitudeDeg: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const lat = 50.0 + i * 0.002;
    const lon = 13.0 + (i % 2 === 0 ? amplitudeDeg : -amplitudeDeg);
    points.push([lon, lat]);
  }
  return points;
}

/** A dense, genuinely wiggly track (several sine periods) — not collinear. */
function buildWigglyTrack(count: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const lat = 50.0 + i * 0.0005;
    const lon = 13.0 + 0.01 * Math.sin((i / count) * 20 * Math.PI);
    points.push([lon, lat]);
  }
  return points;
}

describe("ingestTrack", () => {
  it("case 1: distance is measured on the RAW points, not the simplified geometry", () => {
    const points = buildZigZagTrack(60, 0.0005);
    const parsed = withTimestamps(points);

    const result = ingestTrack(parsed, { toleranceDeg: 0.01 });

    expect(result).not.toBeNull();
    const simplifiedDistanceKm = polylineDistanceKm(result?.geometry ?? []);
    expect(result?.distanceKm).toBeGreaterThan(simplifiedDistanceKm);
    // Sanity: the tolerance was chosen large enough to actually collapse the
    // zigzag, otherwise this test would pass for the wrong reason.
    expect(result?.geometry.length).toBeLessThan(points.length);
  });

  it("case 2: simplification reduces point count on a dense track, keeping first/last exact", () => {
    const points = buildZigZagTrack(200, 0.00003);
    const parsed = withTimestamps(points);

    const result = ingestTrack(parsed);

    expect(result).not.toBeNull();
    expect(result?.geometry.length).toBeLessThan(points.length);
    expect(result?.geometry[0]).toEqual(points[0]);
    expect(result?.geometry[result.geometry.length - 1]).toEqual(points[points.length - 1]);
    // pointCount always reports the RAW count, regardless of simplification.
    expect(result?.pointCount).toBe(points.length);
  });

  it("case 3: the cap holds — a track above maxPoints comes back at or below it, not stored whole", () => {
    // Default cap is 2000 (see DEFAULT_MAX_POINTS in ingestTrack.ts): a day of
    // driving at one point every few seconds is tens of thousands of raw
    // points, but the simplified geometry lands in a JSON column read back on
    // every map render — 2000 vertices stays visually faithful without
    // putting megabytes in a row.
    const points = buildWigglyTrack(3000);
    const parsed = withTimestamps(points);

    const result = ingestTrack(parsed);

    expect(result).not.toBeNull();
    expect(points.length).toBeGreaterThan(2000);
    expect(result?.geometry.length).toBeLessThanOrEqual(2000);
    // The cap is enforced by raising the tolerance and re-simplifying, never
    // by truncation — first/last must still be the true endpoints.
    expect(result?.geometry[0]).toEqual(points[0]);
    expect(result?.geometry[result.geometry.length - 1]).toEqual(points[points.length - 1]);
    // Distance is still measured on all 3000 raw points either way.
    expect(result?.pointCount).toBe(3000);
  });

  it("case 4: a track already below the cap, with real turns, comes back essentially as-is", () => {
    // Turns of 0.01 deg are far above the default tolerance (0.0001 deg), so
    // Douglas-Peucker keeps every vertex — nothing here is simplified away.
    const points: Array<[number, number]> = [
      [13.0, 50.0],
      [13.01, 50.001],
      [13.0, 50.002],
      [13.01, 50.003],
      [13.0, 50.004],
    ];
    const parsed = withTimestamps(points);

    const result = ingestTrack(parsed);

    expect(result).not.toBeNull();
    expect(result?.geometry).toEqual(points);
    expect(result?.pointCount).toBe(points.length);
  });

  it("case 5: returns null when startedAt is missing — cannot be matched to a leg by time", () => {
    const parsed: ParsedTrack = {
      points: [
        [13.0, 50.0],
        [13.01, 50.001],
      ],
      startedAt: null,
      endedAt: new Date("2026-06-01T08:10:00Z"),
      name: null,
    };

    expect(ingestTrack(parsed)).toBeNull();
  });

  it("case 6: returns null when endedAt is missing", () => {
    const parsed: ParsedTrack = {
      points: [
        [13.0, 50.0],
        [13.01, 50.001],
      ],
      startedAt: new Date("2026-06-01T08:00:00Z"),
      endedAt: null,
      name: null,
    };

    expect(ingestTrack(parsed)).toBeNull();
  });
});

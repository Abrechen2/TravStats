import { describe, it, expect } from "@jest/globals";

import { adoptSegment, ANCHOR_TOLERANCE_KM } from "../adoptTrack";
import { polylineDistanceKm } from "../../../cruiseDistance/polylineDistance";
import type { Coord } from "../../tourDistance";

/**
 * Task 5 (Phase 3b tour tracks), Part A: adopting a leg's geometry from a
 * segment of a recorded track. Pure — no file system, no database, no
 * network.
 *
 * All test tracks run along a fixed meridian (constant longitude) with
 * increasing latitude, spaced ~22 km apart (0.2 deg lat), so distances are
 * easy to reason about: well inside `ANCHOR_TOLERANCE_KM` (1 km) counts as
 * "at" a point, and 0.2 deg away is unambiguously "not at" it.
 */

const LON = 8.0;

/** `track[i]` sits at `58.0 + i * 0.2` degrees latitude, constant longitude. */
function buildMeridianTrack(count: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    points.push([LON, 58.0 + i * 0.2]);
  }
  return points;
}

/** A stop a few hundred metres off `track[index]` — still within the anchor tolerance. */
function nearTrackPoint(track: Array<[number, number]>, index: number): Coord {
  const [lon, lat] = track[index];
  return { lat: lat + 0.002, lon }; // ~0.22 km off — comfortably inside 1 km
}

describe("adoptSegment", () => {
  it("case 1: a track passing near both stops adopts the segment between them, in travel order", () => {
    const track = buildMeridianTrack(6); // indices 0..5
    const from = nearTrackPoint(track, 1);
    const to = nearTrackPoint(track, 4);

    const result = adoptSegment(track, from, to);

    expect(result).not.toBeNull();
    expect(result?.waypoints).toEqual(track.slice(1, 5));
    expect(result?.distanceKm).toBeCloseTo(polylineDistanceKm(track.slice(1, 5)), 6);
  });

  it("case 2: a stop far from every point on the track returns null", () => {
    const track = buildMeridianTrack(6);
    const from = nearTrackPoint(track, 1);
    const farAway: Coord = { lat: 70.0, lon: LON }; // nowhere near this track

    expect(adoptSegment(track, from, farAway)).toBeNull();
    // Sanity: the failing stop really is outside the tolerance, not just
    // outside some accidentally-tiny default.
    expect(ANCHOR_TOLERANCE_KM).toBeLessThan(100);
  });

  it("case 3: a track traversing the two stops in the OPPOSITE order comes back reversed, from -> to", () => {
    const track = buildMeridianTrack(6);
    // The leg's `from` is further ALONG the track than its `to` — a return
    // leg on a round trip, say.
    const from = nearTrackPoint(track, 4);
    const to = nearTrackPoint(track, 1);

    const result = adoptSegment(track, from, to);

    expect(result).not.toBeNull();
    const expectedForward = track.slice(1, 5); // [idx1, idx2, idx3, idx4]
    const expectedReversed = [...expectedForward].reverse(); // [idx4, idx3, idx2, idx1]
    expect(result?.waypoints).toEqual(expectedReversed);
    // First point anchors to `from` (idx4), last point anchors to `to` (idx1).
    expect(result?.waypoints[0]).toEqual(track[4]);
    expect(result?.waypoints[result.waypoints.length - 1]).toEqual(track[1]);
    expect(result?.distanceKm).toBeCloseTo(polylineDistanceKm(expectedReversed), 6);
  });

  it("case 4: a track that passes one stop TWICE (a loop) deterministically picks the EARLIEST occurrence", () => {
    // A loop: index 0 and index 4 are both at (approximately) the same
    // place as `from` — the vehicle started there and came back. `to` sits
    // once, in the middle, at index 2.
    const track: Array<[number, number]> = [
      [LON, 58.0], // 0 — "from", first visit
      [LON, 58.2], // 1
      [LON, 58.4], // 2 — "to"
      [LON, 58.2], // 3
      [LON, 58.0], // 4 — "from", second visit (the loop closes)
    ];
    const from: Coord = { lat: 58.0, lon: LON }; // exactly matches idx 0 AND idx 4
    const to: Coord = { lat: 58.4, lon: LON }; // exactly matches idx 2

    const result = adoptSegment(track, from, to);

    expect(result).not.toBeNull();
    // Earliest occurrence (idx 0), not the later one (idx 4): the adopted
    // segment is the FIRST leg of the loop, [idx0, idx1, idx2], not the
    // longer way around through idx3/idx4.
    expect(result?.waypoints).toEqual(track.slice(0, 3));
    expect(result?.distanceKm).toBeCloseTo(polylineDistanceKm(track.slice(0, 3)), 6);
  });

  it("case 5: the adopted distance is measured on the ADOPTED SEGMENT, not the whole track", () => {
    const track = buildMeridianTrack(10); // a much longer track than the leg needs
    const from = nearTrackPoint(track, 2);
    const to = nearTrackPoint(track, 4);

    const result = adoptSegment(track, from, to);

    expect(result).not.toBeNull();
    const wholeTrackKm = polylineDistanceKm(track);
    const segmentKm = polylineDistanceKm(track.slice(2, 5));
    expect(result?.distanceKm).toBeCloseTo(segmentKm, 6);
    expect(result?.distanceKm).toBeLessThan(wholeTrackKm);
  });

  it("respects a custom maxAnchorKm rather than the default", () => {
    const track = buildMeridianTrack(6);
    const from: Coord = { lat: 58.0 + 0.05, lon: LON }; // ~5.5 km off idx 0
    const to = nearTrackPoint(track, 3);

    // Default tolerance (1 km) rejects it...
    expect(adoptSegment(track, from, to)).toBeNull();
    // ...but a wider one accepts the same track/stops.
    expect(adoptSegment(track, from, to, { maxAnchorKm: 10 })).not.toBeNull();
  });

  it("a track too short to form a segment (one point, or both stops nearest the same point) returns null", () => {
    const singlePoint: Array<[number, number]> = [[LON, 58.0]];
    const stop: Coord = { lat: 58.0, lon: LON };
    expect(adoptSegment(singlePoint, stop, stop)).toBeNull();

    const track = buildMeridianTrack(6);
    const samePoint = nearTrackPoint(track, 2);
    expect(adoptSegment(track, samePoint, samePoint)).toBeNull();
  });
});

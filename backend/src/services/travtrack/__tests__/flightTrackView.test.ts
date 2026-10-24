import { cutFlightTrackWith } from "../flightTrackView";

/**
 * A cut flight line describes only what is left (security review of T5): its
 * distance, its vertex count, its altitude profile and which ends lost their
 * time.
 */

const ZONE_AT_ARRIVAL = { lat: 52.52, lon: 13.4, radiusM: 1000 };
const base = {
  geometry: [
    [8.56, 50.03],
    [10, 51],
    [13.4, 52.52],
  ],
  segmentStarts: [0],
  startedAt: new Date("2026-03-01T08:00:00Z"),
  distanceKm: 430,
  pointCount: 3,
};

describe("cutFlightTrackWith", () => {
  it("measures, counts and profiles only what is left, and names the hidden end", () => {
    const { track, startCut, endCut } = cutFlightTrackWith(
      {
        ...base,
        cumulativeKm: [0, 150, 430],
        elevations: [
          [0, 100],
          [150, 10000],
          [200, 11000],
          [430, 40],
        ],
      },
      [ZONE_AT_ARRIVAL]
    );
    expect(track).toMatchObject({
      distanceKm: 150,
      pointCount: 2,
      cumulativeKm: [0, 150],
      elevations: [
        [0, 100],
        [150, 10000],
      ],
    });
    expect([startCut, endCut]).toEqual([false, true]);
  });

  it("measures on the sphere without a running distance, and drops a profile it cannot place", () => {
    const { track } = cutFlightTrackWith({ ...base, elevations: [[0, 1]] }, [ZONE_AT_ARRIVAL]);
    expect(track.distanceKm).toBeGreaterThan(100);
    expect(track.distanceKm).toBeLessThan(150);
    expect(track.elevations).toBeNull();
  });

  it("leaves an uncut line exactly as it was", () => {
    const far = { lat: 0, lon: 0, radiusM: 100 };
    const input = { ...base, cumulativeKm: [0, 150, 430] };
    expect(cutFlightTrackWith(input, [far])).toEqual({
      track: input,
      startCut: false,
      endCut: false,
    });
  });
});

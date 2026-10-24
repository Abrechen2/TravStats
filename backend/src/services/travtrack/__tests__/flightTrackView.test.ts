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

  it("breaks a chord between two kept vertices that crosses a zone, though no vertex goes", () => {
    // Both vertices far outside a zone that lies on the straight line between them.
    const zone = { lat: 50, lon: 10, radiusM: 2000 };
    const { track, startCut, endCut } = cutFlightTrackWith(
      {
        geometry: [
          [8, 50],
          [9, 50.5],
          [11, 49.5],
          [12, 50],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 90, 260, 350],
        elevations: [
          [0, 10],
          [90, 900],
          [200, 1000],
          [260, 800],
          [350, 20],
        ],
        startedAt: new Date("2026-03-01T08:00:00Z"),
        distanceKm: 350,
        pointCount: 4,
      },
      [zone]
    );
    expect(track.geometry).toEqual([
      [8, 50],
      [9, 50.5],
      [11, 49.5],
      [12, 50],
    ]);
    // Two pieces now: the chord through the zone is no longer drawn.
    expect(track.segmentStarts).toEqual([0, 2]);
    // No figure counts the distance through the hidden chord.
    expect(track.cumulativeKm).toEqual([0, 90, 90, 180]);
    expect(track.distanceKm).toBe(180);
    expect(track.elevations).toEqual([
      [0, 10],
      [90, 900],
      [90, 800],
      [180, 20],
    ]);
    expect([startCut, endCut]).toEqual([false, false]);
  });

  it("rebases the running distance and the profile past a removed stretch", () => {
    const zone = { lat: 51, lon: 10, radiusM: 1000 }; // over the middle vertex
    const { track } = cutFlightTrackWith(
      {
        geometry: [
          [8, 50],
          [8.5, 50.2],
          [10, 51],
          [12, 52],
          [12.5, 52.2],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 40, 160, 300, 340],
        elevations: [
          [20, 500],
          [100, 9000],
          [320, 400],
        ],
        startedAt: new Date("2026-03-01T08:00:00Z"),
        distanceKm: 340,
        pointCount: 5,
      },
      [zone]
    );
    expect(track.segmentStarts).toEqual([0, 2]);
    expect(track.cumulativeKm).toEqual([0, 40, 40, 80]);
    expect(track.distanceKm).toBe(80);
    // 100 km lay in the hidden part; 320 becomes 40 + (320 - 300).
    expect(track.elevations).toEqual([
      [20, 500],
      [60, 400],
    ]);
  });
});

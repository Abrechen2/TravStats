import { cutFlightTrackWith } from "../flightTrackView";
import { zoneSafeFlightColumns } from "../providerFlightColumns";
import { haversineKm } from "../../../shared/geo/haversine";

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

const rawKm = (a: number[], b: number[]) =>
  haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
const round = (km: number) => Math.round(km * 1000) / 1000;
const chordKm = (a: number[], b: number[]) => round(rawKm(a, b));

describe("cutFlightTrackWith", () => {
  it("serves the stored figures unchanged while no zone was ever in force", () => {
    const input = { ...base, cumulativeKm: [0, 150, 430], jitterDropped: 3 };
    expect(cutFlightTrackWith(input, [])).toEqual({
      track: input,
      startCut: false,
      endCut: false,
    });
  });

  it("derives every figure from the shown line once any zone was in force, however far", () => {
    // Codex P1: a 5 km margin proves nothing — jitter filtering or a raised
    // simplification tolerance can take out a fix arbitrarily far from the
    // kept chords, and its contribution lived on in the stored figures.
    const far = { lat: -33.9, lon: 151.2, radiusM: 100 };
    const { track, startCut, endCut } = cutFlightTrackWith(
      {
        ...base,
        cumulativeKm: [0, 150, 430],
        jitterDropped: 0,
        elevations: [
          [0, 100],
          [150, 10000],
          [430, 40],
        ],
      },
      [far]
    );
    const first = chordKm([8.56, 50.03], [10, 51]);
    const total = round(rawKm([8.56, 50.03], [10, 51]) + rawKm([10, 51], [13.4, 52.52]));
    expect(track.geometry).toEqual(base.geometry);
    expect(track.cumulativeKm).toEqual([0, first, total]);
    expect(track.distanceKm).toBe(total);
    expect(track.pointCount).toBe(3);
    expect(track.jitterDropped).toBeNull();
    // The profile keeps the samples at the shown vertices.
    expect(track.elevations).toEqual([
      [0, 100],
      [first, 10000],
      [total, 40],
    ]);
    // Nothing was filtered and both ends are the recorded ends: their times stand.
    expect([startCut, endCut]).toEqual([false, false]);
  });

  it("gives no end a time once the jitter filter changed the recording", () => {
    const far = { lat: -33.9, lon: 151.2, radiusM: 100 };
    const { startCut, endCut } = cutFlightTrackWith({ ...base, jitterDropped: 2 }, [far]);
    // The first shown vertex may be a stay's middle, not the first recorded fix.
    expect([startCut, endCut]).toEqual([true, true]);
  });

  it("keeps an end's time when nothing filtered it (an unchecked line was never touched)", () => {
    const far = { lat: -33.9, lon: 151.2, radiusM: 100 };
    const { startCut, endCut } = cutFlightTrackWith({ ...base, jitterDropped: null }, [far]);
    expect([startCut, endCut]).toEqual([false, false]);
  });

  it("gives no end a time when the line cannot say whether it was filtered", () => {
    const far = { lat: -33.9, lon: 151.2, radiusM: 100 };
    const { startCut, endCut } = cutFlightTrackWith(base, [far]);
    expect([startCut, endCut]).toEqual([true, true]);
  });

  it("measures, counts and profiles only what is left, and names the hidden end", () => {
    const { track, startCut, endCut } = cutFlightTrackWith(
      {
        ...base,
        cumulativeKm: [0, 150, 430],
        jitterDropped: 0,
        elevations: [
          [0, 100],
          [150, 10000],
          [200, 11000],
          [430, 40],
        ],
      },
      [ZONE_AT_ARRIVAL]
    );
    const first = chordKm([8.56, 50.03], [10, 51]);
    expect(track).toMatchObject({
      geometry: base.geometry.slice(0, 2),
      distanceKm: first,
      pointCount: 2,
      jitterDropped: null,
      cumulativeKm: [0, first],
      // Samples beyond the last shown chord are gone.
      elevations: [
        [0, 100],
        [first, 10000],
      ],
    });
    expect([startCut, endCut]).toEqual([false, true]);
  });

  it("drops a profile it cannot place without a running distance", () => {
    const { track } = cutFlightTrackWith({ ...base, elevations: [[0, 1]] }, [ZONE_AT_ARRIVAL]);
    expect(track.distanceKm).toBe(chordKm([8.56, 50.03], [10, 51]));
    expect(track.elevations).toBeNull();
  });

  it("breaks a chord between two kept vertices that crosses a zone, though no vertex goes", () => {
    // Both vertices far outside a zone that lies on the straight line between them.
    const zone = { lat: 50, lon: 10, radiusM: 2000 };
    const geometry: Array<[number, number]> = [
      [8, 50],
      [9, 50.5],
      [11, 49.5],
      [12, 50],
    ];
    const { track, startCut, endCut } = cutFlightTrackWith(
      {
        geometry,
        segmentStarts: [0],
        cumulativeKm: [0, 90, 260, 350],
        elevations: [
          [0, 10],
          [90, 900],
          [200, 1000],
          [260, 800],
          [350, 20],
        ],
        jitterDropped: 0,
        startedAt: new Date("2026-03-01T08:00:00Z"),
        distanceKm: 350,
        pointCount: 4,
      },
      [zone]
    );
    expect(track.geometry).toEqual(geometry);
    // Two pieces now: the chord through the zone is no longer drawn.
    expect(track.segmentStarts).toEqual([0, 2]);
    const a = chordKm(geometry[0], geometry[1]);
    const b = round(rawKm(geometry[0], geometry[1]) + rawKm(geometry[2], geometry[3]));
    // No figure counts the distance through the hidden chord.
    expect(track.cumulativeKm).toEqual([0, a, a, b]);
    expect(track.distanceKm).toBe(b);
    // The sample on the hidden chord (200 km) is gone.
    expect(track.elevations).toEqual([
      [0, 10],
      [a, 900],
      [a, 800],
      [b, 20],
    ]);
    expect([startCut, endCut]).toEqual([false, false]);
  });

  it("a line beside a zone is measured on its kept chords, not on the stored detour", () => {
    // A meridian chord 2.8 km beside a 1 km zone: no vertex is inside and the
    // chord does not cross it, but a fix simplification dropped could have
    // been inside, and the stored running distance would count that detour.
    const zone = { lat: 51, lon: 10.04, radiusM: 1000 };
    const { track } = cutFlightTrackWith(
      {
        geometry: [
          [10, 50],
          [10, 52],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 260],
        jitterDropped: 4,
        startedAt: new Date("2026-03-01T08:00:00Z"),
        distanceKm: 260,
        pointCount: 40,
      },
      [zone]
    );
    expect(track.distanceKm).toBe(chordKm([10, 50], [10, 52]));
    expect(track.cumulativeKm).toEqual([0, track.distanceKm]);
    expect(track.pointCount).toBe(2);
    expect(track.jitterDropped).toBeNull();
  });

  it("a line beside a zone shows no altitude sample between its vertices", () => {
    // Security review: a sample inside a kept chord's stored range may come
    // from a fix simplification dropped — here one inside the zone.
    const zone = { lat: 51, lon: 10.04, radiusM: 1000 };
    const { track } = cutFlightTrackWith(
      {
        geometry: [
          [10, 50],
          [10, 52],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 260],
        elevations: [
          [0, 100],
          [130, 34],
          [131, 35],
          [260, 50],
        ],
        jitterDropped: 0,
        startedAt: new Date("2026-03-01T08:00:00Z"),
        distanceKm: 260,
        pointCount: 40,
      },
      [zone]
    );
    expect(track.elevations).toEqual([
      [0, 100],
      [track.distanceKm, 50],
    ]);
  });

  it("a sample at a segment boundary goes when the vertex beside it is hidden", () => {
    // Two segments meet at 100 km; the second one's first vertex lies in the zone.
    const zone = { lat: 51, lon: 11, radiusM: 1000 };
    const { track } = cutFlightTrackWith(
      {
        geometry: [
          [9, 50],
          [10, 50.5],
          [11, 51],
          [12, 51.5],
          [13, 52],
        ],
        segmentStarts: [0, 2],
        cumulativeKm: [0, 100, 100, 180, 260],
        elevations: [
          [0, 10],
          [100, 777],
          [180, 900],
          [260, 20],
        ],
        jitterDropped: 0,
        startedAt: new Date("2026-03-01T08:00:00Z"),
      },
      [zone]
    );
    expect(track.elevations).toEqual([
      [0, 10],
      [(track.cumulativeKm as number[])[2], 900],
      [(track.cumulativeKm as number[])[3], 20],
    ]);
  });

  it("an end the cut removed has no time", () => {
    const zone = { lat: 50, lon: 10, radiusM: 300 };
    const { startCut, endCut } = cutFlightTrackWith(
      {
        geometry: [
          [10, 50],
          [10, 51],
          [10, 52],
        ],
        segmentStarts: [0],
        jitterDropped: 0,
        startedAt: new Date("2026-03-01T08:00:00Z"),
      },
      [zone]
    );
    expect([startCut, endCut]).toEqual([true, false]);
  });

  it("has no trust margin left to tune", async () => {
    const module = await import("../flightTrackView");
    expect("FIGURE_TRUST_MARGIN_M" in module).toBe(false);
  });
});

describe("zoneSafeFlightColumns", () => {
  const T0 = Date.parse("2026-03-01T08:00:00Z");
  const line = Array.from({ length: 10 }, (_, i) => ({
    t: T0 + i * 60_000,
    lat: 50 + i * 0.06,
    // The sixth fix strays 4 m east: simplification would drop it.
    lon: i === 5 ? 10.00006 : 10,
  }));
  const zone = { lat: 50.3, lon: 10.00006, radiusM: 3 };

  it("leaves a fix inside a zone out before anything is measured, and breaks the line there", () => {
    const columns = zoneSafeFlightColumns(line, [zone]);
    expect(columns).not.toBeNull();
    expect(columns!.pointCount).toBe(9);
    expect(columns!.segmentStarts).toHaveLength(2);
    // Eight steps of ~6.67 km would be ~53 km; the step over the zone is not counted.
    expect(columns!.distanceKm).toBeLessThan(48);
  });

  it("measures an untouched line exactly as the pipeline does", () => {
    const columns = zoneSafeFlightColumns(line, []);
    expect(columns!.pointCount).toBe(10);
    expect(columns!.segmentStarts).toEqual([0]);
  });

  it("breaks the line at a deleted range and measures no step across it", () => {
    // Fixes 4 and 5 were deleted: the range lies between fix 3 and fix 6.
    const kept = line.filter((_, i) => i !== 4 && i !== 5);
    const breaks: Array<[number, number]> = [[T0 + 3.5 * 60_000, T0 + 5.5 * 60_000]];
    const columns = zoneSafeFlightColumns(kept, [], breaks);
    expect(columns!.segmentStarts).toHaveLength(2);
    // Six steps of ~6.67 km are ~40 km; bridged, the 20 km across the deleted span made ~60.
    expect(columns!.distanceKm).toBeLessThan(45);
  });

  it("a deleted range outside every step changes nothing", () => {
    const columns = zoneSafeFlightColumns(line, [], [[T0 - 600_000, T0 - 60_000]]);
    expect(columns!.segmentStarts).toEqual([0]);
  });

  it("is null when nothing outside the zones makes a line", () => {
    expect(zoneSafeFlightColumns(line.slice(5, 6), [zone])).toBeNull();
  });
});

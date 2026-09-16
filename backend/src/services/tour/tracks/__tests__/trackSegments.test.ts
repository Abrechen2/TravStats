import { parseGpx } from "../parseGpx";
import { ingestTrack } from "../ingestTrack";
import { adoptSegment } from "../adoptTrack";

/**
 * A gap in a recording is not a distance travelled, and a simplified line is
 * not a measurement.
 *
 * GPX separates continuous stretches of recording with `<trkseg>` — the
 * receiver was switched off, or lost its fix. The parser flattened every
 * segment into one point list, so the jump between them became a straight line
 * that the distance counted as ground covered: two 1.1 km stretches ten degrees
 * apart measured 1113 km (audit finding AUD-033).
 *
 * The second half is what happens afterwards. The stored geometry is
 * Douglas-Peucker simplified, and every dropped vertex is a chord cutting a
 * corner — so a leg that adopted the WHOLE track re-measured that line and came
 * out 7% under the figure shown right beside it on the track, with no way back
 * to the raw number from two remaining points (audit finding AUD-034).
 *
 * Primary source for the segment semantics: GPX 1.1, `trksegType` —
 * https://www.topografix.com/GPX/1/1/#type_trksegType
 */
const T = (n: number) => `2026-05-01T10:${String(n).padStart(2, "0")}:00Z`;

/** Two 0.01-degree stretches on the equator, `gapDeg` apart. */
function twoSegmentGpx(gapDeg: number): string {
  const seg = (lonStart: number, t0: number) => `
    <trkseg>
      <trkpt lat="0" lon="${lonStart}"><time>${T(t0)}</time></trkpt>
      <trkpt lat="0" lon="${lonStart + 0.01}"><time>${T(t0 + 1)}</time></trkpt>
    </trkseg>`;
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><name>Two parts</name>${seg(0, 0)}${seg(gapDeg, 10)}</trk></gpx>`;
}

describe("recording segments", () => {
  it("reports where each segment starts", () => {
    const parsed = parseGpx(twoSegmentGpx(10));
    expect(parsed).not.toBeNull();
    expect(parsed!.points).toHaveLength(4);
    expect(parsed!.segmentStarts).toEqual([0, 2]);
  });

  it("does not count the gap between them as distance", () => {
    const ingested = ingestTrack(parseGpx(twoSegmentGpx(10))!);
    expect(ingested).not.toBeNull();

    // Two stretches of ~1.112 km each. The connector across ten degrees of
    // longitude — some 1113 km — is not travel and is not counted.
    expect(ingested!.distanceKm).toBeGreaterThan(2.2);
    expect(ingested!.distanceKm).toBeLessThan(2.3);
    expect(ingested!.segmentStarts).toEqual([0, 2]);
  });

  it("still measures a single continuous recording end to end", () => {
    // The positive case: a track with one segment must be unaffected, or the
    // assertion above could pass on a rule that simply drops distance.
    const oneSegment = `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="0" lon="0"><time>${T(0)}</time></trkpt>
  <trkpt lat="0" lon="10"><time>${T(1)}</time></trkpt>
</trkseg></trk></gpx>`;
    const ingested = ingestTrack(parseGpx(oneSegment)!);

    expect(ingested!.segmentStarts).toEqual([0]);
    expect(ingested!.distanceKm).toBeGreaterThan(1100);
  });
});

describe("adopting a whole track", () => {
  /** 101 points on a zigzag: dense enough that simplification really cuts. */
  function zigzag(): string {
    const pts: string[] = [];
    for (let i = 0; i <= 100; i++) {
      const lat = i % 2 === 0 ? 0 : 0.0002;
      pts.push(`<trkpt lat="${lat}" lon="${(i * 0.0001).toFixed(6)}"><time>2026-05-01T10:00:${String(
        i % 60,
      ).padStart(2, "0")}Z</time></trkpt>`);
    }
    return `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
  }

  it("returns the track's own raw distance, not the simplified line's", () => {
    const ingested = ingestTrack(parseGpx(zigzag())!, { toleranceDeg: 0.001 })!;
    // The premise: simplification really did throw vertices away. Without this
    // the assertion below would hold trivially.
    expect(ingested.geometry.length).toBeLessThan(ingested.pointCount);

    const first = ingested.geometry[0];
    const last = ingested.geometry[ingested.geometry.length - 1];
    const adoption = adoptSegment(
      ingested.geometry,
      { lat: first[1], lon: first[0] },
      { lat: last[1], lon: last[0] },
      { cumulativeKm: ingested.cumulativeKm },
    );

    expect(adoption).not.toBeNull();
    expect(adoption!.basis).toBe("raw");
    expect(adoption!.distanceKm).toBeCloseTo(ingested.distanceKm, 6);
  });

  it("says so when it had to fall back to the stored line", () => {
    // A row written before the cumulative column existed.
    const ingested = ingestTrack(parseGpx(zigzag())!, { toleranceDeg: 0.001 })!;
    const first = ingested.geometry[0];
    const last = ingested.geometry[ingested.geometry.length - 1];

    const adoption = adoptSegment(
      ingested.geometry,
      { lat: first[1], lon: first[0] },
      { lat: last[1], lon: last[0] },
      { cumulativeKm: null },
    );

    expect(adoption!.basis).toBe("simplified");
    // And it is measurably short — which is the defect, still visible on old
    // rows and now labelled rather than presented as the truth.
    expect(adoption!.distanceKm).toBeLessThan(ingested.distanceKm);
  });
});

describe("adopting across a recording gap", () => {
  it("is flagged, so the endpoint can refuse it", () => {
    const ingested = ingestTrack(parseGpx(twoSegmentGpx(10))!)!;
    const first = ingested.geometry[0];
    const last = ingested.geometry[ingested.geometry.length - 1];

    const adoption = adoptSegment(
      ingested.geometry,
      { lat: first[1], lon: first[0] },
      { lat: last[1], lon: last[0] },
      {
        // Both ends are far apart, so the anchor tolerance would refuse them
        // anyway — raised here so the GAP is what the test is about.
        maxAnchorKm: 5000,
        cumulativeKm: ingested.cumulativeKm,
        segmentStarts: ingested.segmentStarts,
      },
    );

    expect(adoption).not.toBeNull();
    expect(adoption!.spansRecordingGap).toBe(true);
  });

  it("is not flagged when the whole leg sits inside one segment", () => {
    const ingested = ingestTrack(parseGpx(twoSegmentGpx(10))!)!;
    const a = ingested.geometry[0];
    const b = ingested.geometry[1];

    const adoption = adoptSegment(
      ingested.geometry,
      { lat: a[1], lon: a[0] },
      { lat: b[1], lon: b[0] },
      { cumulativeKm: ingested.cumulativeKm, segmentStarts: ingested.segmentStarts },
    );

    expect(adoption!.spansRecordingGap).toBe(false);
  });
});

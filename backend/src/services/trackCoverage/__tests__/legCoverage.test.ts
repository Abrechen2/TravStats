import {
  CRUISE_TRACK_ANCHOR_KM,
  cruiseLegsCoverage,
  tourLegCoverage,
  tourLegVerdict,
} from "../legCoverage";
import type { StoredTrack } from "../storedTrack";
import { adoptSegment } from "../../tour/tracks/adoptTrack";

/** A straight north-south line at `lon`, one point every `stepDeg` of latitude. */
function meridian(
  lon: number,
  fromLat: number,
  toLat: number,
  stepDeg = 0.05
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const dir = toLat >= fromLat ? 1 : -1;
  const n = Math.round(Math.abs(toLat - fromLat) / stepDeg);
  for (let i = 0; i <= n; i++) points.push([lon, +(fromLat + dir * i * stepDeg).toFixed(6)]);
  return points;
}

function stored(
  geometry: Array<[number, number]>,
  segmentStarts: number[] | null = [0]
): StoredTrack {
  return { geometry, segmentStarts, cumulativeKm: null };
}

/** Kilometres per degree of latitude — enough precision for these assertions. */
const KM_PER_DEG = 111.2;

describe("tourLegCoverage — the verdict IS the adoption rule", () => {
  const track = stored(meridian(8, 58.0, 58.1, 0.001));
  const from = { lat: 58.0, lon: 8 };
  const to = { lat: 58.1, lon: 8 };

  it("covers a leg whose two stops the recording passes", () => {
    const verdict = tourLegCoverage(track, from, to);
    expect(verdict.status).toBe("covered");
    expect(verdict.reason).toBe("complete");
  });

  it("agrees with adoptSegment on a stop 1.5 km off the line (outside the 1 km tolerance)", () => {
    const offTo = { lat: 58.1, lon: 8.025 };
    expect(adoptSegment(track.geometry, from, offTo)).toBeNull();
    expect(tourLegCoverage(track, from, offTo)).toMatchObject({
      status: "notCovered",
      reason: "missesTo",
    });
  });

  it("names the recording starting mid-leg", () => {
    const lateStart = stored(meridian(8, 58.05, 58.1, 0.001));
    expect(tourLegCoverage(lateStart, from, to).reason).toBe("missesFrom");
  });

  it("refuses a slice across an unrecorded stretch, as the 409 does (AUD-033)", () => {
    const geometry = meridian(8, 58.0, 58.1, 0.001);
    const verdict = tourLegCoverage(stored(geometry, [0, 50]), from, to);
    expect(verdict).toMatchObject({ status: "notCovered", reason: "recordingGap" });
  });

  it("picks the oldest covering recording and otherwise the most useful refusal", () => {
    const elsewhere = { id: "far", track: stored(meridian(20, 40, 41)) };
    const late = { id: "late", track: stored(meridian(8, 58.05, 58.1, 0.001)) };
    const full = { id: "full", track };
    expect(tourLegVerdict([elsewhere, late, full], from, to)).toEqual({
      trackId: "full",
      status: "covered",
      reason: "complete",
    });
    expect(tourLegVerdict([elsewhere, late], from, to)).toEqual({
      trackId: "late",
      status: "notCovered",
      reason: "missesFrom",
    });
    expect(tourLegVerdict([elsewhere], from, to)).toEqual({
      trackId: null,
      status: "notCovered",
      reason: "missesBoth",
    });
    expect(tourLegVerdict([], from, to)).toBeNull();
  });
});

describe("cruiseLegsCoverage", () => {
  const A = { lat: 54, lon: 5 };
  const B = { lat: 56, lon: 5 };
  const C = { lat: 58, lon: 5 };

  it("cuts each leg of a voyage between leaving one port and reaching the next", () => {
    const [ab, bc] = cruiseLegsCoverage(stored(meridian(5, 54, 58)), [
      { from: A, to: B },
      { from: B, to: C },
    ]);
    expect(ab.status).toBe("covered");
    expect(bc.status).toBe("covered");
    expect(ab.slice!.waypoints[0]).toEqual([5, 54]);
    expect(ab.slice!.waypoints[ab.slice!.waypoints.length - 1]).toEqual([5, 56]);
    expect(ab.slice!.distanceKm).toBeCloseTo(2 * KM_PER_DEG, -1);
    expect(bc.slice!.waypoints[0]).toEqual([5, 56]);
  });

  it("accepts a ship anchored 5 km off a tender port — the 1 km tour rule would not", () => {
    // The recording turns back 0.045° (5 km) short of B's catalogue point.
    const track = stored(meridian(5, 54, 55.955));
    const tender = cruiseLegsCoverage(track, [{ from: A, to: B }]);
    expect(tender[0].status).toBe("covered");
    expect(CRUISE_TRACK_ANCHOR_KM).toBeGreaterThan(5);
    expect(tourLegCoverage(track, A, B).status).toBe("notCovered");
  });

  it("cuts a round trip by sailing order, not by the point nearest the port", () => {
    // Kiel → Oslo → Kiel in miniature: A → B → A. Nearest-point matching puts
    // the second leg's arrival at the START of the recording.
    const out = meridian(5, 54, 56);
    const back = meridian(5, 56, 54).slice(1);
    const [outbound, inbound] = cruiseLegsCoverage(stored([...out, ...back]), [
      { from: A, to: B },
      { from: B, to: A },
    ]);
    expect(inbound.status).toBe("covered");
    expect(inbound.slice!.waypoints[0]).toEqual([5, 56]);
    expect(inbound.slice!.waypoints[inbound.slice!.waypoints.length - 1]).toEqual([5, 54]);
    expect(inbound.slice!.distanceKm).toBeCloseTo(outbound.slice!.distanceKm, 5);
  });

  it("leaves a leg the recording started after, and still finds the legs it has", () => {
    const [ab, bc] = cruiseLegsCoverage(stored(meridian(5, 56, 58)), [
      { from: A, to: B },
      { from: B, to: C },
    ]);
    expect(ab).toMatchObject({ status: "notCovered", reason: "missesFrom", slice: null });
    expect(bc.status).toBe("covered");
  });

  it("names a recording that stops mid-leg", () => {
    const [ab] = cruiseLegsCoverage(stored(meridian(5, 54, 55)), [{ from: A, to: B }]);
    expect(ab).toMatchObject({ status: "notCovered", reason: "missesTo" });
  });

  it("does not read a recording sailed the other way as this leg", () => {
    const [ab] = cruiseLegsCoverage(stored(meridian(5, 56, 54)), [{ from: A, to: B }]);
    expect(ab.status).toBe("notCovered");
  });

  it("bridges a hole at sea with its chord and counts the chord as sailed", () => {
    // A 30 km hole (0.27°) in the middle of A → B, marked as its own segment.
    const first = meridian(5, 54, 55);
    const second = meridian(5, 55.27, 56);
    const geometry = [...first, ...second];
    const [ab] = cruiseLegsCoverage(stored(geometry, [0, first.length]), [{ from: A, to: B }]);
    expect(ab.status).toBe("coveredWithGaps");
    expect(ab.reason).toBe("bridgedGaps");
    expect(ab.slice!.gapKm).toBeCloseTo(0.27 * KM_PER_DEG, -1);
    // Along the whole line: the hole is part of the distance, not left out.
    expect(ab.slice!.distanceKm).toBeCloseTo(2 * KM_PER_DEG, -1);
  });

  it("measures a hole against the raw running total when one is stored", () => {
    const first = meridian(5, 54, 55);
    const second = meridian(5, 55.25, 56);
    const geometry = [...first, ...second];
    // Raw total runs 10% over the line (the corners the simplifier cut) and
    // stands still across the hole — what `ingestTrack` writes.
    const cumulativeKm: number[] = [];
    let total = 0;
    geometry.forEach((_, i) => {
      if (i > 0 && i !== first.length) total += 0.05 * KM_PER_DEG * 1.1;
      cumulativeKm.push(total);
    });
    const [ab] = cruiseLegsCoverage({ geometry, segmentStarts: [0, first.length], cumulativeKm }, [
      { from: A, to: B },
    ]);
    const recorded = cumulativeKm[cumulativeKm.length - 1];
    expect(ab.slice!.distanceKm).toBeCloseTo(recorded + ab.slice!.gapKm, 6);
  });

  it("refuses a leg that is mostly hole", () => {
    // Recorded only near the two ports: 1.4° of a 2° leg is a hole.
    const first = meridian(5, 54, 54.3);
    const second = meridian(5, 55.7, 56);
    const [ab] = cruiseLegsCoverage(stored([...first, ...second], [0, first.length]), [
      { from: A, to: B },
    ]);
    expect(ab).toMatchObject({ status: "notCovered", reason: "tooManyGaps" });
  });

  it("finds a port the simplified line runs straight through, with no vertex near it", () => {
    // What a straight three-port voyage is stored as: its two ends.
    const [ab, bc] = cruiseLegsCoverage(
      stored([
        [5, 54],
        [5, 58],
      ]),
      [
        { from: A, to: B },
        { from: B, to: C },
      ]
    );
    expect(ab.status).toBe("covered");
    expect(bc.status).toBe("covered");
    // Within one interpolation step: what the ship did between arriving at B
    // and leaving it belongs to neither leg.
    expect(Math.abs(ab.slice!.distanceKm + bc.slice!.distanceKm - 4 * KM_PER_DEG)).toBeLessThan(6);
    // The map gets the stored vertex and the cut point, not the helpers.
    expect(ab.slice!.waypoints).toHaveLength(2);
  });

  it("does not let the chord across a hole reach a port", () => {
    // Recorded up to 55°, then nothing until 57° — B at 56° sits on the chord.
    const track = stored(
      [
        [5, 54],
        [5, 55],
        [5, 57],
        [5, 58],
      ],
      [0, 2]
    );
    const [ab] = cruiseLegsCoverage(track, [{ from: A, to: B }]);
    expect(ab).toMatchObject({ status: "notCovered", reason: "missesTo" });
  });

  it("covers nothing with a recording of another sea", () => {
    const [ab] = cruiseLegsCoverage(stored(meridian(20, 35, 36)), [{ from: A, to: B }]);
    expect(ab).toMatchObject({ status: "notCovered", reason: "missesBoth" });
  });
});

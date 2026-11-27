import type { StoredPoint } from "../../../tripRecording/segments";
import { lowSources, smoothedSegments } from "../dayCleanup";

/** Smoothing reaches only stretches of a low-scoring source (rc46 extras C1). */
const MIN = 60_000;
const p = (min: number, lat: number): StoredPoint => [min * MIN, lat, 8, 50];
const spiky = () => [p(0, 50), p(1, 50.001), p(2, 50.02), p(3, 50.003), p(4, 50.004)];

describe("smoothedSegments", () => {
  const google = spiky();
  const phone = spiky();
  const origin = new Map<StoredPoint, string>([
    ...google.map((q) => [q, "gpx:google"] as [StoredPoint, string]),
    ...phone.map((q) => [q, "companion:phone"] as [StoredPoint, string]),
  ]);
  const read = {
    segments: [google, phone],
    rowOf: (q: StoredPoint) => ({ origin: origin.get(q)! }) as never,
  };
  const low = lowSources({
    sources: [
      { source: "gpx:google", kind: "import", score: 0.3, points: 5, accuracyKnownShare: 0 },
      { source: "companion:phone", kind: "phone", score: 0.9, points: 5, accuracyKnownShare: 1 },
    ],
  });

  it("smooths the low-scoring source and leaves the good one exactly as read", () => {
    const out = smoothedSegments(read, low);
    expect(out[0][2][1]).toBe(50.003);
    expect(out[1]).toEqual(phone);
  });

  it("never changes the read it was given", () => {
    smoothedSegments(read, low);
    expect(google[2][1]).toBe(50.02);
  });
});

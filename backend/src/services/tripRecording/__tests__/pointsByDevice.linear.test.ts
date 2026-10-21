import { pointsByDevice, type RecordingBatchRow } from "../segments";

/**
 * The Companion uploads a trip recording in many small batches, and every
 * map read gathers them per device. Copying a device's growing list once per
 * batch makes that quadratic in the number of batches — 20 000 one-point
 * batches are 200 million copies, enough to hold the event loop before the
 * yielding jitter filter even starts. The work must stay proportional to the
 * points, which this counts deterministically: every element an array
 * iterator hands out while the batches are gathered.
 */

function countArrayIterations<T>(work: () => T): { result: T; iterated: number } {
  const proto = Array.prototype as unknown as Record<symbol, () => Iterator<unknown>>;
  const original = proto[Symbol.iterator];
  let iterated = 0;
  proto[Symbol.iterator] = function (this: unknown[]) {
    const inner = original.call(this);
    return {
      next: () => {
        const step = inner.next();
        if (!step.done) iterated++;
        return step;
      },
      [Symbol.iterator]() {
        return this;
      },
    } as Iterator<unknown>;
  };
  try {
    return { result: work(), iterated };
  } finally {
    proto[Symbol.iterator] = original;
  }
}

describe("pointsByDevice — work proportional to the points", () => {
  it("gathers 2 000 one-point batches without copying the growing list per batch", () => {
    const start = Date.UTC(2026, 4, 1);
    const batches: RecordingBatchRow[] = Array.from({ length: 2000 }, (_, i) => ({
      deviceId: i % 2 === 0 ? "a" : "b",
      points: [[start + i * 300_000, 35.68, 139.76, 25]],
    }));
    const { result, iterated } = countArrayIterations(() => pointsByDevice(batches, "UTC"));
    expect(result.map((d) => [d.deviceId, d.points.length])).toEqual([
      ["a", 1000],
      ["b", 1000],
    ]);
    // Quadratic gathering iterates ~1 000 000 elements here; linear a few per point.
    expect(iterated).toBeLessThanOrEqual(4 * 2000);
  });
});

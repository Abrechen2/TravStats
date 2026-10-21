import { noise } from "./jitterFixtures";
import { medianPaced, runPaced, runPacedYielding, type Paced } from "../pacing";

/** The median by sorting — what the selection must agree with to the last bit. */
function sortedMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe("medianPaced", () => {
  const rnd = noise(11);
  const cases: Array<[string, number[]]> = [
    ["one value", [4]],
    ["two values", [9, 1]],
    ["odd, shuffled", Array.from({ length: 1001 }, () => rnd() * 300)],
    ["even, shuffled", Array.from({ length: 1000 }, () => rnd() * 300)],
    ["sorted", Array.from({ length: 5000 }, (_, i) => i * 0.5)],
    ["reversed", Array.from({ length: 5000 }, (_, i) => 5000 - i)],
    ["many duplicates", Array.from({ length: 4000 }, (_, i) => i % 3)],
    ["all equal", Array.from({ length: 3000 }, () => 7)],
  ];

  it.each(cases)("%s: the same value as a sort", (_label, values) => {
    expect(runPaced(medianPaced(Float64Array.from(values)))).toBe(sortedMedian(values));
  });

  it("is NaN for no values", () => {
    expect(runPaced(medianPaced(new Float64Array(0)))).toBeNaN();
  });
});

describe("the two drivers", () => {
  function* counting(n: number): Paced<number> {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += k;
      yield;
    }
    return sum;
  }

  it("answer the same", async () => {
    expect(runPaced(counting(10_000))).toBe(await runPacedYielding(counting(10_000), 0));
  });
});

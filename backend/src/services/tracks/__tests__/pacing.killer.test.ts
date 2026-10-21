import { medianPaced, runPaced } from "../pacing";

/**
 * Security review of forgejo#319: the median is computed over an upload's own
 * values, and plain median-of-three quickselect is quadratic on a crafted
 * order. The order here is built by McIlroy's adversary ("A Killer Adversary
 * for Quicksort", 1999) run against a replica of that selection: values are
 * decided lazily, always so that the pivot lands next to an end of the range.
 */

/** The selection as it was before the bound, comparing through `cmp`. Returns its comparison count. */
function unboundedSelect(items: Int32Array, k: number, cmp: (a: number, b: number) => number) {
  const swap = (a: number, b: number) => {
    const t = items[a];
    items[a] = items[b];
    items[b] = t;
  };
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cmp(items[m], items[lo]) < 0) swap(m, lo);
    if (cmp(items[hi], items[lo]) < 0) swap(hi, lo);
    if (cmp(items[hi], items[m]) < 0) swap(hi, m);
    const pivot = items[m];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (cmp(items[i], pivot) < 0) i++;
      while (cmp(items[j], pivot) > 0) j--;
      if (i <= j) {
        swap(i, j);
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
}

/** McIlroy's adversary: the input order that makes `unboundedSelect` quadratic, and its cost. */
function killerSequence(n: number): { values: Float64Array; comparisons: number } {
  const gas = n;
  const val = new Int32Array(n).fill(gas);
  let solid = 0;
  let candidate = 0;
  let comparisons = 0;
  const cmp = (x: number, y: number) => {
    comparisons++;
    if (val[x] === gas && val[y] === gas) {
      if (x === candidate) val[x] = solid++;
      else val[y] = solid++;
    }
    if (val[x] === gas) candidate = x;
    else if (val[y] === gas) candidate = y;
    return val[x] - val[y];
  };
  const items = Int32Array.from({ length: n }, (_, i) => i);
  unboundedSelect(items, n >> 1, cmp);
  // Whatever is still gas was never told apart: any distinct order above the solid ones.
  for (let i = 0; i < n; i++) if (val[i] === gas) val[i] = solid++;
  return { values: Float64Array.from(val), comparisons };
}

describe("the median stays bounded on an adversarial order", () => {
  const n = 40_000;
  const { values, comparisons } = killerSequence(n);

  it("the order is a killer for the unbounded selection", () => {
    // Quadratic: at least n²/16 comparisons where a good order costs a few n.
    expect(comparisons).toBeGreaterThan((n * n) / 16);
  });

  it("is answered correctly and in O(n log n) time", () => {
    const sorted = Float64Array.from(values).sort();
    const expected = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    runPaced(medianPaced(Float64Array.from(values))); // warm up the JIT
    const started = performance.now();
    const median = runPaced(medianPaced(Float64Array.from(values)));
    const elapsedMs = performance.now() - started;
    expect(median).toBe(expected);
    // ~2 ms bounded; the unbounded selection spends hundreds of ms on n²/16 comparisons.
    expect(elapsedMs).toBeLessThan(60);
  });
});

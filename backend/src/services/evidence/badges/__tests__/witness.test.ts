import { DEFAULT_WITNESS_BUDGET, findWitness, type Witness } from "../witness";

/** The witness is asked of a measure only through `progress`, so plain folds stand in for badges. */
type Row = { id: string; country?: string; route?: string; day?: number };

const count = async (rows: readonly Row[]) => rows.length;
const distinctCountries = async (rows: readonly Row[]) => new Set(rows.map((r) => r.country)).size;
const busiestRoute = async (rows: readonly Row[]) => {
  const per = new Map<string, number>();
  for (const r of rows) per.set(r.route!, (per.get(r.route!) ?? 0) + 1);
  return Math.max(0, ...per.values());
};
/** 1 when two rows share a day — a "tight connection": no row scores alone. */
const pair = async (rows: readonly Row[]) =>
  new Set(rows.map((r) => r.day)).size < rows.length ? 1 : 0;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The witness, asserted to be a complete answer rather than an abstention. */
function found<R>(w: Witness<R>): { rows: R[]; contributions: number[]; progress: number } {
  if (w.exhausted) throw new Error("the witness abstained");
  return w;
}

describe("findWitness", () => {
  it("lists every counted row of a count, each adding one", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = found(await findWitness(rows, count));
    expect(w.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(w.contributions).toEqual([1, 1, 1]);
  });

  it("keeps one row per member of a set, and the shares add up to the set", async () => {
    const rows = ["DE", "DE", "FR", "DE", "IT", "FR"].map((country, i) => ({
      id: `${i}`,
      country,
    }));
    const w = found(await findWitness(rows, distinctCountries));
    expect(w.progress).toBe(3);
    expect(w.rows).toHaveLength(3);
    expect(new Set(w.rows.map((r) => r.country)).size).toBe(3);
    expect(sum(w.contributions)).toBe(3);
  });

  it("keeps the group that holds a maximum", async () => {
    const rows = ["A", "B", "A", "C", "A", "B"].map((route, i) => ({ id: `${i}`, route }));
    const w = found(await findWitness(rows, busiestRoute));
    expect(w.rows.map((r) => r.route)).toEqual(["A", "A", "A"]);
    expect(sum(w.contributions)).toBe(3);
  });

  it("finds a pair where no row scores alone", async () => {
    const rows = [1, 2, 3, 3, 4].map((day, i) => ({ id: `${i}`, day }));
    const w = found(await findWitness(rows, pair));
    expect(w.rows.map((r) => r.day)).toEqual([3, 3]);
    expect(sum(w.contributions)).toBe(1);
  });

  it("lists nothing for a badge at zero", async () => {
    expect(await findWitness([{ id: "a", day: 1 }], pair)).toEqual({
      exhausted: false,
      rows: [],
      contributions: [],
      progress: 0,
    });
  });
});

/**
 * Security review of forgejo#265: one request must not fold an account's rows
 * without bound. Every evaluation is charged — the figure, the alone pass, the
 * shrink and the contributions alike — and an exhausted budget abstains.
 */
describe("findWitness — bounded work", () => {
  const meter = <R>(progress: (rows: readonly R[]) => Promise<number>) => {
    const used = { evaluations: 0, rows: 0 };
    const measured = async (rows: readonly R[]) => {
      used.evaluations += 1;
      used.rows += rows.length;
      return progress(rows);
    };
    return { used, measured };
  };
  const family = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${i}`,
      country: `C${i % 40}`,
      day: i,
      route: "A",
    }));
  const within = (used: { evaluations: number; rows: number }) => {
    expect(used.evaluations).toBeLessThanOrEqual(DEFAULT_WITNESS_BUDGET.evaluations);
    expect(used.rows).toBeLessThanOrEqual(DEFAULT_WITNESS_BUDGET.rows);
  };

  it.each([
    ["a count", count],
    ["a set", distinctCountries],
    ["a maximum", busiestRoute],
    ["a pair", pair],
  ])("keeps every path within the budget on 20 000 rows — %s", async (_kind, measure) => {
    const { used, measured } = meter(measure);
    const started = Date.now();
    const w = await findWitness(family(20_000), measured);
    within(used);
    expect(Date.now() - started).toBeLessThan(10_000);
    if (w.exhausted) expect(w.progress === null || w.progress >= 0).toBe(true);
  });

  it("abstains when the budget runs out — never a half-shrunk set", async () => {
    const { used, measured } = meter(distinctCountries);
    const w = await findWitness(family(5000), measured, {
      budget: { evaluations: 50, rows: 20_000 },
    });
    expect(w).toEqual({ exhausted: true, progress: 40 });
    expect(used.evaluations).toBeLessThanOrEqual(50);
  });

  it("abstains on the figure too when even one fold of every row is over budget", async () => {
    const w = await findWitness(family(5000), count, { budget: { evaluations: 10, rows: 100 } });
    expect(w).toEqual({ exhausted: true, progress: null });
  });

  it("reads declared shares in one pass, folding only the figure", async () => {
    const { used, measured } = meter(count);
    const w = found(await findWitness(family(20_000), measured, { share: () => 1 }));
    expect(w.rows).toHaveLength(20_000);
    expect(used.evaluations).toBe(1);
  });

  it("does not trust shares that do not add up to the figure", async () => {
    const rows = ["DE", "DE", "FR"].map((country, i) => ({ id: `${i}`, country }));
    const w = found(await findWitness(rows, distinctCountries, { share: () => 1 }));
    expect(w.rows).toHaveLength(2);
  });
});

import { findWitness } from "../witness";

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

describe("findWitness", () => {
  it("lists every counted row of a count, each adding one", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = await findWitness(rows, count);
    expect(w.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(w.contributions).toEqual([1, 1, 1]);
  });

  it("keeps one row per member of a set, and the shares add up to the set", async () => {
    const rows = ["DE", "DE", "FR", "DE", "IT", "FR"].map((country, i) => ({
      id: `${i}`,
      country,
    }));
    const w = await findWitness(rows, distinctCountries);
    expect(w.progress).toBe(3);
    expect(w.rows).toHaveLength(3);
    expect(new Set(w.rows.map((r) => r.country)).size).toBe(3);
    expect(sum(w.contributions)).toBe(3);
  });

  it("keeps the group that holds a maximum", async () => {
    const rows = ["A", "B", "A", "C", "A", "B"].map((route, i) => ({ id: `${i}`, route }));
    const w = await findWitness(rows, busiestRoute);
    expect(w.rows.map((r) => r.route)).toEqual(["A", "A", "A"]);
    expect(sum(w.contributions)).toBe(3);
  });

  it("finds a pair where no row scores alone", async () => {
    const rows = [1, 2, 3, 3, 4].map((day, i) => ({ id: `${i}`, day }));
    const w = await findWitness(rows, pair);
    expect(w.rows.map((r) => r.day)).toEqual([3, 3]);
    expect(sum(w.contributions)).toBe(1);
  });

  it("lists nothing for a badge at zero", async () => {
    expect(await findWitness([{ id: "a", day: 1 }], pair)).toEqual({
      rows: [],
      contributions: [],
      progress: 0,
    });
  });

  it("stops shrinking at the budget and still returns a set that reaches the progress", async () => {
    const rows = Array.from({ length: 64 }, (_, i) => ({
      id: `${i}`,
      country: i === 63 ? "FR" : "DE",
    }));
    const w = await findWitness(rows, distinctCountries, { budget: 2 });
    expect(await distinctCountries(w.rows)).toBe(2);
    expect(sum(w.contributions)).toBe(2);
  });
});

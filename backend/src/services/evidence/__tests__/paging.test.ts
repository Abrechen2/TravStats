import { sliceEntries, sortEntries } from "../paging";
import type { EvidenceEntry } from "../../../schemas/evidence";

function entry(id: string, date: string | null): EvidenceEntry {
  return {
    domain: "flight",
    id,
    href: null,
    title: { text: id },
    subtitle: null,
    date: date ? { value: date, precision: "day" } : null,
  };
}

describe("sortEntries", () => {
  it("orders by date descending", () => {
    const entries = [entry("a", "2026-01-01"), entry("b", "2026-06-01"), entry("c", "2026-03-01")];
    expect(sortEntries(entries).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a date tie by id ascending", () => {
    const entries = [entry("c", "2026-01-01"), entry("a", "2026-01-01"), entry("b", "2026-01-01")];
    expect(sortEntries(entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  /**
   * The invariant this suite exists to pin: an undated row is not a row
   * from epoch zero. Sorting it as `1970-01-01` would put it FIRST under
   * date-descending order — exactly the lie `shared/lodgingTiming.ts`
   * refuses for a stay with unknown nights.
   */
  it("sorts undated rows last, never first", () => {
    const entries = [entry("dated", "2020-01-01"), entry("undated", null)];
    expect(sortEntries(entries).map((e) => e.id)).toEqual(["dated", "undated"]);
  });

  it("breaks a tie among several undated rows by id ascending too", () => {
    const entries = [entry("z", null), entry("a", null), entry("m", "2026-01-01")];
    expect(sortEntries(entries).map((e) => e.id)).toEqual(["m", "a", "z"]);
  });

  it("does not mutate its input", () => {
    const entries = [entry("b", "2020-01-01"), entry("a", "2021-01-01")];
    const copy = [...entries];
    sortEntries(entries);
    expect(entries).toEqual(copy);
  });
});

describe("sliceEntries", () => {
  it("returns a bounded window at offset/limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(String(i), "2026-01-01"));
    expect(sliceEntries(entries, { offset: 3, limit: 4 }).map((e) => e.id)).toEqual([
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("returns an empty page past the end", () => {
    const entries = [entry("a", "2026-01-01")];
    expect(sliceEntries(entries, { offset: 5, limit: 10 })).toEqual([]);
  });
});

/**
 * The invariant "Paging, not a promise" (the design spec's own name for
 * this section) asks for: 250 fixture rows, paged at 100, must concatenate
 * to exactly the unpaged list. A page boundary that reorders drops or
 * repeats a row — sorting BEFORE slicing is what this test protects.
 */
describe("sortEntries + sliceEntries — the 250-row fixture", () => {
  it("pages a 250-row measure without dropping or repeating a row", () => {
    const entries: EvidenceEntry[] = [];
    for (let i = 0; i < 250; i++) {
      // Every third row is undated, on purpose — the fixture must prove the
      // rule under a mix, not only in the all-dated or all-undated case.
      const dated = i % 3 !== 0;
      const day = 1 + (i % 27);
      const month = 1 + (i % 12);
      entries.push(
        entry(
          `row-${String(i).padStart(3, "0")}`,
          dated ? `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null
        )
      );
    }
    // Shuffle deterministically so the fixture does not start pre-sorted.
    const shuffled = [...entries].reverse();

    const sorted = sortEntries(shuffled);
    expect(sorted).toHaveLength(250);

    const pageSize = 100;
    const pages: EvidenceEntry[][] = [];
    for (let offset = 0; offset < sorted.length; offset += pageSize) {
      pages.push(sliceEntries(sorted, { offset, limit: pageSize }));
    }
    const concatenated = pages.flat();

    expect(concatenated).toEqual(sorted);
    expect(concatenated.map((e) => e.id).sort()).toEqual(entries.map((e) => e.id).sort());

    // Undated rows are the tail, not scattered — the last N rows (N = the
    // count of undated fixture rows) and no dated row trails behind them.
    const undatedCount = entries.filter((e) => e.date === null).length;
    const tail = concatenated.slice(concatenated.length - undatedCount);
    expect(tail.every((e) => e.date === null)).toBe(true);
    expect(
      concatenated.slice(0, concatenated.length - undatedCount).every((e) => e.date !== null)
    ).toBe(true);
  });
});

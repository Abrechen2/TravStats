import { collectBackfillCandidates } from "../backfillScan";

type Row = { id: string; done: boolean };

/** Rows r1..rN, every third one needing work. */
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, done: (i + 1) % 3 !== 0 }));

const pager = (all: Row[]) => {
  const calls: Array<string | null> = [];
  const loadPage = async (afterId: string | null, take: number): Promise<Row[]> => {
    calls.push(afterId);
    const start = afterId === null ? 0 : all.findIndex((r) => r.id === afterId) + 1;
    return all.slice(start, start + take);
  };
  return { loadPage, calls };
};

describe("collectBackfillCandidates", () => {
  it("walks past the first page — a candidate on page three is found", async () => {
    // Ten rows, page size 4, the only candidates are r3, r6, r9.
    const all = rows(10);
    const { loadPage, calls } = pager(all);

    const out = await collectBackfillCandidates({
      loadPage,
      needsWork: (r) => !r.done,
      limit: 500,
      pageSize: 4,
    });

    expect(out.map((r) => r.id)).toEqual(["r3", "r6", "r9"]);
    // Three pages: [r1..r4], [r5..r8], [r9, r10] — the short last page ends it.
    expect(calls).toEqual([null, "r4", "r8"]);
  });

  it("stops at the limit without loading pages it will not use", async () => {
    const all = rows(100);
    const { loadPage, calls } = pager(all);

    const out = await collectBackfillCandidates({
      loadPage,
      needsWork: (r) => !r.done,
      limit: 2,
      pageSize: 10,
    });

    expect(out.map((r) => r.id)).toEqual(["r3", "r6"]);
    expect(calls).toEqual([null]);
  });

  it("returns nothing for an empty table and asks exactly once", async () => {
    const { loadPage, calls } = pager([]);

    const out = await collectBackfillCandidates({
      loadPage,
      needsWork: () => true,
      limit: 5,
      pageSize: 10,
    });

    expect(out).toEqual([]);
    expect(calls).toEqual([null]);
  });

  it("does not ask for a page beyond one that came back full but ended the rows", async () => {
    // Exactly one full page and nothing after it: the scan asks once more,
    // gets an empty page, and stops — never loops.
    const all = rows(4);
    const { loadPage, calls } = pager(all);

    const out = await collectBackfillCandidates({
      loadPage,
      needsWork: (r) => !r.done,
      limit: 500,
      pageSize: 4,
    });

    expect(out.map((r) => r.id)).toEqual(["r3"]);
    expect(calls).toEqual([null, "r4"]);
  });
});

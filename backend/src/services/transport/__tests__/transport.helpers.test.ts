import { idsInLocalYear, utcWindowForLocalYear } from "../localYear";
import { linkCompanions, replaceCompanionLinks } from "../companionLinks";

describe("services/transport helpers (forgejo#382)", () => {
  it("reads a window wide enough for UTC+14 and UTC-12 around the year", () => {
    const w = utcWindowForLocalYear(2025);
    expect(w.gte.toISOString()).toBe("2024-12-31T10:00:00.000Z");
    expect(w.lt.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("keeps only the rows the domain rule files under the year", async () => {
    const rows = [
      { id: "a", year: 2025 },
      { id: "b", year: 2024 },
      { id: "c", year: 2025 },
    ];
    const ids = await idsInLocalYear(
      2025,
      async () => rows,
      (r) => r.year
    );
    expect(ids).toEqual(["a", "c"]);
  });

  it("writes ordered links and replaces them without touching an empty list's insert", async () => {
    const calls: string[] = [];
    // Stateful fake: the rows a parent holds, so a person who stays is found by findMany.
    const rows: Array<{ companionId: string; position: number; rideId: string }> = [];
    const delegate = {
      deleteMany: async (a: { where: { rideId: string; companionId?: { notIn: string[] } } }) => {
        const notIn = a.where.companionId?.notIn;
        calls.push(`delete ${a.where.rideId}${notIn ? ` notIn ${notIn.join(",")}` : ""}`);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].rideId === a.where.rideId && (!notIn || !notIn.includes(rows[i].companionId)))
            rows.splice(i, 1);
        }
      },
      findMany: async (a: { where: { rideId: string } }) =>
        rows
          .filter((r) => r.rideId === a.where.rideId)
          .map((r) => ({ companionId: r.companionId })),
      updateMany: async (a: {
        where: { rideId: string; companionId: string };
        data: { position: number };
      }) => {
        calls.push(`update ${a.where.companionId}@${a.data.position}:${a.where.rideId}`);
        for (const r of rows)
          if (r.rideId === a.where.rideId && r.companionId === a.where.companionId)
            r.position = a.data.position;
      },
      createMany: async (a: {
        data: Array<{ companionId: string; position: number; rideId: string }>;
      }) => {
        calls.push(
          `create ${a.data.map((r) => `${r.companionId}@${r.position}:${r.rideId}`).join(",")}`
        );
        rows.push(...a.data);
      },
    };
    await replaceCompanionLinks(delegate, "rideId", "r1", [{ id: "x" }, { id: "y" }]);
    // Re-sent in a new order with one person gone: the survivor keeps its row (and the
    // per-traveller facts on it, D7) — updated in place, never deleted and re-created.
    await replaceCompanionLinks(delegate, "rideId", "r1", [{ id: "y" }]);
    await replaceCompanionLinks(delegate, "rideId", "r1", []);
    await linkCompanions(delegate, "rideId", "r2", []);
    expect(calls).toEqual([
      "delete r1 notIn x,y",
      "create x@0:r1",
      "create y@1:r1",
      "delete r1 notIn y",
      "update y@0:r1",
      "delete r1 notIn ",
    ]);
    expect(rows).toEqual([]);
  });
});

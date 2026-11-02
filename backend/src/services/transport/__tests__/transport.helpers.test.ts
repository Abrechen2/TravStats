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
    const delegate = {
      deleteMany: async (a: { where: Record<"rideId", string> }) => {
        calls.push(`delete ${a.where.rideId}`);
      },
      createMany: async (a: {
        data: Array<{ companionId: string; position: number; rideId: string }>;
      }) => {
        calls.push(
          `create ${a.data.map((r) => `${r.companionId}@${r.position}:${r.rideId}`).join(",")}`
        );
      },
    };
    await replaceCompanionLinks(delegate, "rideId", "r1", [{ id: "x" }, { id: "y" }]);
    await replaceCompanionLinks(delegate, "rideId", "r1", []);
    await linkCompanions(delegate, "rideId", "r2", []);
    expect(calls).toEqual(["delete r1", "create x@0:r1,y@1:r1", "delete r1"]);
  });
});

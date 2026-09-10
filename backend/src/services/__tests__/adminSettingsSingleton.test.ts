import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../adminSettingsRow";

/**
 * `AdminSettings` is a singleton, and nothing in the schema said so.
 *
 * Eleven places created the row with the same shape — read it, and if there is
 * none, insert one. Two of those running at once on a fresh instance both saw
 * nothing and both inserted, and from then on the instance had two rows. Every
 * read used a bare `findFirst()`, which Postgres answers in physical order, so
 * the answer moved whenever an UPDATE moved a tuple: an admin saved the Immich
 * URL on one page and another page read the other row.
 *
 * Not from the audit list — this came out of a red `lodgingCurrencyEndToEnd`,
 * whose test database held FOUR settings rows.
 *
 * Both halves are asserted: concurrent ensures produce ONE row, and a read is
 * deterministic even on an instance that is already split.
 */
describe("the admin settings singleton", () => {
  let saved: unknown[] = [];

  beforeAll(async () => {
    saved = await prisma.adminSettings.findMany();
    await prisma.adminSettings.deleteMany({});
  });

  afterAll(async () => {
    await prisma.adminSettings.deleteMany({});
    if (saved.length > 0) {
      // Restore the suite's shared row(s) exactly as they were — other tests
      // read them, and a settings row rewritten with defaults is a silent
      // change to every one of them.
      await prisma.adminSettings.createMany({
        data: saved as never,
        skipDuplicates: true,
      });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.adminSettings.deleteMany({});
  });

  it("creates exactly one row when eight callers ask at once", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensureAdminSettingsRow()));

    const rows = await prisma.adminSettings.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    // And every caller was handed the same row, not just "a" row.
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(rows[0].id);
  });

  it("returns the existing row rather than adding another", async () => {
    const first = await ensureAdminSettingsRow();
    const second = await ensureAdminSettingsRow();

    expect(second).toBe(first);
    expect(await prisma.adminSettings.count()).toBe(1);
  });

  it("answers the same row every time on an instance that is already split", async () => {
    // The damage a past race left behind: two rows, one of them configured.
    const a = await prisma.adminSettings.create({ data: { instanceName: "first" } });
    const b = await prisma.adminSettings.create({ data: { instanceName: "second" } });
    expect(b.id).toBeGreaterThan(a.id);

    // Touch the LOWER row so its tuple moves to the end of the heap — this is
    // exactly what made a bare findFirst() start answering with the other one.
    await prisma.adminSettings.update({ where: { id: a.id }, data: { instanceName: "first!" } });

    const reads = await Promise.all([
      prisma.adminSettings.findFirst({ orderBy: { id: "asc" } }),
      prisma.adminSettings.findFirst({ orderBy: { id: "asc" } }),
    ]);
    expect(reads.map((r) => r?.id)).toEqual([a.id, a.id]);
    expect(await ensureAdminSettingsRow()).toBe(a.id);
  });
});

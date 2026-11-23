import request from "supertest";

import { prisma } from "../../../db";
import app from "../../../index";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { pruneChangeHistory, retentionCutoff } from "../retention";
import { retainedLedgerRowsSql } from "../retentionPolicy";

/**
 * Rolling retention of the change history (owner, 2026-11-23): rows older than the
 * account's window (3/6/12/24 months, 12 by default) are deleted, in bounded
 * batches; the setting round-trips; the account archive carries only the window.
 */
describe("retentionCutoff at a month end (rc.45 review)", () => {
  it("clamps to the target month's last day instead of overflowing into the next month", () => {
    expect(retentionCutoff(1, new Date("2026-03-31T10:00:00Z")).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z"
    );
    expect(retentionCutoff(6, new Date("2026-08-31T00:00:00Z")).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z"
    );
    expect(retentionCutoff(12, new Date("2028-02-29T05:00:00Z")).toISOString()).toBe(
      "2027-02-28T05:00:00.000Z"
    );
    expect(retentionCutoff(3, new Date("2026-11-23T03:58:00Z")).toISOString()).toBe(
      "2026-08-23T03:58:00.000Z"
    );
  });
});

describe("change history retention", () => {
  const NOW = new Date("2026-11-23T03:58:00Z");
  const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
  let cookieA: string;

  const monthsAgo = (m: number, extraDays = 0) => {
    const d = retentionCutoff(m, NOW);
    d.setUTCDate(d.getUTCDate() - extraDays);
    return d;
  };
  const row = (userId: string, createdAt: Date, entityId = "e1") =>
    prisma.changeLedgerEntry.create({
      data: {
        userId,
        changeSetId: `cs-${Math.random()}`,
        entityType: "flight",
        entityId,
        operation: "update",
        field: "gate",
        oldValue: '"A"',
        newValue: '"B"',
        source: "web",
        createdAt,
      },
    });
  const count = (userId: string) => prisma.changeLedgerEntry.count({ where: { userId } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["hret-a", "hret-b", "hret-c"] } } });
    for (const k of ["a", "b", "c"] as const) {
      const u = await prisma.user.create({
        data: { username: `hret-${k}`, passwordHash: await hashPassword("password123") },
      });
      ids[k] = u.id;
    }
    // a: 3 months, b: no settings row (default 12), c: 24 months.
    await prisma.userSettings.create({
      data: { userId: ids.a, data: {}, changeHistoryRetentionMonths: 3 },
    });
    await prisma.userSettings.create({
      data: { userId: ids.c, data: {}, changeHistoryRetentionMonths: 24 },
    });
    cookieA = `auth_token=${generateToken(ids.a)}`;
  });

  beforeEach(async () => {
    await prisma.changeLedgerEntry.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.userSettings.update({
      where: { userId: ids.a },
      data: { changeHistoryRetentionMonths: 3 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it("deletes only rows older than each account's own window", async () => {
    await row(ids.a, monthsAgo(3, 1)); // gone (older than 3 months)
    await row(ids.a, monthsAgo(3, -1)); // kept
    await row(ids.b, monthsAgo(12, 1)); // gone (default 12)
    await row(ids.b, monthsAgo(6)); // kept: beyond a's window, inside b's
    await row(ids.c, monthsAgo(24, 1)); // gone
    await row(ids.c, monthsAgo(13)); // kept: beyond the default, inside c's 24
    await prisma.changeLedgerEntry.deleteMany({ where: { userId: { notIn: Object.values(ids) } } });
    const deletedBefore = await count(ids.a);
    expect(deletedBefore).toBe(2);

    await pruneChangeHistory(NOW);

    expect(await count(ids.a)).toBe(1);
    expect(await count(ids.b)).toBe(1);
    expect(await count(ids.c)).toBe(1);
    const kept = await prisma.changeLedgerEntry.findMany({ where: { userId: ids.b } });
    expect(kept[0].createdAt.getTime()).toBe(monthsAgo(6).getTime());
  });

  it("deletes in bounded batches: five old rows with a batch of two take three statements", async () => {
    for (let i = 0; i < 5; i += 1) await row(ids.b, monthsAgo(12, 10 + i), `old-${i}`);
    await row(ids.b, monthsAgo(1), "recent");
    const spy = jest.spyOn(prisma, "$executeRaw");
    try {
      const total = await pruneChangeHistory(NOW, 2, 0);
      expect(total).toBe(5);
      // 3 statements for the default window (2+2+1), one empty pass for each other window.
      expect(spy).toHaveBeenCalledTimes(3 + 3);
    } finally {
      spy.mockRestore();
    }
    expect(await count(ids.b)).toBe(1);
  });

  it("round-trips the setting and refuses a value that is not a choice", async () => {
    const read = await request(app).get("/api/v1/change-history/retention").set("Cookie", cookieA);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ months: 3, options: [3, 6, 12, 24] });

    const put = await request(app)
      .put("/api/v1/change-history/retention")
      .set("Cookie", cookieA)
      .send({ months: 24 });
    expect(put.status).toBe(200);
    expect(put.body.months).toBe(24);
    const again = await request(app).get("/api/v1/change-history/retention").set("Cookie", cookieA);
    expect(again.body.months).toBe(24);

    const bad = await request(app)
      .put("/api/v1/change-history/retention")
      .set("Cookie", cookieA)
      .send({ months: 5 });
    expect(bad.status).toBe(400);
    const after = await request(app).get("/api/v1/change-history/retention").set("Cookie", cookieA);
    expect(after.body.months).toBe(24);
  });

  it("answers 12 months for an account without a settings row", async () => {
    const res = await request(app)
      .get("/api/v1/change-history/retention")
      .set("Cookie", `auth_token=${generateToken(ids.b)}`);
    expect(res.body.months).toBe(12);
  });

  it("keeps rows past the window out of the account archive's selection", async () => {
    await row(ids.a, new Date(Date.now() - 400 * 86_400_000), "stale"); // window is 3 months
    await row(ids.a, new Date(), "fresh");
    const rows = await prisma.$queryRawUnsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM change_ledger_entries t0 WHERE t0."user_id" = $1 AND ${retainedLedgerRowsSql("t0")}`,
      ids.a
    );
    expect(Number(rows[0].n)).toBe(1);
  });
});

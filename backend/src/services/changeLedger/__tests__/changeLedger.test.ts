import type { Request, Response } from "express";
import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { TABLE_POLICY } from "../../accountArchive/tablePolicy";
import {
  changeContextMiddleware,
  resolveChangeContext,
  withChangeSource,
  withoutChangeLedger,
} from "../context";
import { MAX_VALUE_CHARS } from "../values";
import { asPropagation } from "../../sharing/propagationGuard";
import { injectLedgerFaultForTests, ledgerStats, resetLedgerStats } from "../capture";

/**
 * The change ledger (spec docs/superpowers/specs/2026-11-22-change-history.md):
 * an edit of a travel entry keeps field, old and new value, source and actor;
 * a no-op keeps nothing; a delete is kept; a restore writes the old value back
 * and is itself a row; another account sees none of it.
 */
describe("change ledger", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const flight = (owner: string, over: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId: owner,
        flightNumber: "LH400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 40.64,
        arrLon: -73.78,
        status: "scheduled",
        dataSource: "manual",
        ...over,
      },
    });

  const rowsFor = async (entityId: string) => {
    return prisma.changeLedgerEntry.findMany({
      where: { entityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["chlog", "chlogother"] } } });
    const u = await prisma.user.create({
      data: { username: "chlog", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "chlogother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.changeLedgerEntry.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("records a web edit with field, old and new value, source and actor", async () => {
    const f = await flight(userId, { tags: ["work"] });
    const res = await request(app)
      .post("/api/v1/flights/bulk-edit")
      .set("Cookie", cookie)
      .send({ flightIds: [f.id], tags: { mode: "add", values: ["autumn"] } });
    expect(res.status).toBe(200);

    const rows = await rowsFor(f.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      entityType: "flight",
      operation: "update",
      field: "tags",
      oldValue: JSON.stringify(["work"]),
      newValue: JSON.stringify(["work", "autumn"]),
      source: "web",
      actorUserId: userId,
      label: "LH400 · FRA · JFK",
    });
  });

  it("names the source a background path declares", async () => {
    const f = await flight(userId, { status: "scheduled" });
    await withChangeSource("auto_update", () =>
      prisma.flight.update({ where: { id: f.id }, data: { status: "landed", gate: "B12" } })
    );
    const rows = await rowsFor(f.id);
    expect(rows.map((r) => [r.field, r.source, r.actorUserId])).toEqual(
      expect.arrayContaining([
        ["status", "auto_update", null],
        ["gate", "auto_update", null],
      ])
    );
    expect(new Set(rows.map((r) => r.changeSetId)).size).toBe(1);
  });

  it("tells a paired device and a token apart from the web by the request", () => {
    const seen = (req: object) => {
      let ctx: ReturnType<typeof resolveChangeContext> = null;
      changeContextMiddleware(req as Request, {} as Response, () => {
        ctx = resolveChangeContext();
      });
      return ctx;
    };
    expect(seen({ userId: "u1", apiToken: { deviceId: "d1" } })).toMatchObject({
      source: "companion",
      actorUserId: "u1",
    });
    expect(seen({ userId: "u1", apiToken: { deviceId: null } })).toMatchObject({ source: "api" });
    expect(seen({ userId: "u1" })).toMatchObject({ source: "web" });
    expect(resolveChangeContext()).toMatchObject({ source: "system", actorUserId: null });
  });

  it("names a write the share propagation makes share_sync, whatever else is declared", async () => {
    const f = await flight(userId, { gate: "A1" });
    await withChangeSource("web", () =>
      asPropagation(async () => {
        await prisma.flight.update({ where: { id: f.id }, data: { gate: "A2" } });
      })
    );
    const [row] = await rowsFor(f.id);
    expect(row.source).toBe("share_sync");
  });

  it("leaves no row for a change a transaction rolled back, and exactly one for a committed one", async () => {
    const f = await flight(userId, { gate: "A1" });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.flight.update({ where: { id: f.id }, data: { gate: "R1" } });
        throw new Error("rolled back on purpose");
      })
    ).rejects.toThrow("rolled back on purpose");
    expect((await prisma.flight.findUnique({ where: { id: f.id } }))?.gate).toBe("A1");
    expect(await rowsFor(f.id)).toEqual([]);

    await prisma.$transaction(async (tx) => {
      // The snapshot reads through the transaction: the first write is its "before".
      await tx.flight.update({ where: { id: f.id }, data: { gate: "B1" } });
      await tx.flight.update({ where: { id: f.id }, data: { gate: "B2" } });
    });
    const rows = await rowsFor(f.id);
    // One batch shares a timestamp, so the order is not the point; the pairs are.
    expect(rows.map((r) => [r.oldValue, r.newValue]).sort()).toEqual([
      ['"A1"', '"B1"'],
      ['"B1"', '"B2"'],
    ]);
  });

  it("drops the rows of a nested transaction that rolled back while the outer one committed", async () => {
    const f = await flight(userId, { gate: "A1", seatNumber: "1A" });
    await prisma.$transaction(async (tx) => {
      await tx.flight.update({ where: { id: f.id }, data: { seatNumber: "2B" } });
      await tx
        .$transaction(async (inner) => {
          await inner.flight.update({ where: { id: f.id }, data: { gate: "N1" } });
          throw new Error("inner rolled back");
        })
        .catch(() => undefined);
    });
    const stored = await prisma.flight.findUnique({ where: { id: f.id } });
    expect([stored?.gate, stored?.seatNumber]).toEqual(["A1", "2B"]);
    expect((await rowsFor(f.id)).map((r) => r.field)).toEqual(["seatNumber"]);
  });

  it("sees what the same transaction created: an entry made and edited in one transaction", async () => {
    let id = "";
    await prisma.$transaction(async (tx) => {
      const created = await tx.flight.create({
        data: {
          userId,
          flightNumber: "LH1",
          depLat: 0,
          depLon: 0,
          arrLat: 1,
          arrLon: 1,
          status: "scheduled",
          gate: "C1",
        },
      });
      id = created.id;
      await tx.flight.update({ where: { id }, data: { gate: "C2" } });
    });
    const rows = await rowsFor(id);
    expect(rows.map((r) => [r.oldValue, r.newValue])).toEqual([['"C1"', '"C2"']]);
  });

  describe("a failing ledger never fails the write it describes", () => {
    afterEach(() => injectLedgerFaultForTests(null));

    it.each(["insert", "snapshot"] as const)(
      "a %s that fails inside the user's transaction leaves the user's writes committed",
      async (kind) => {
        const f = await flight(userId, { gate: "A1", seatNumber: "1A" });
        resetLedgerStats();
        injectLedgerFaultForTests(kind);
        await prisma.$transaction(async (tx) => {
          await tx.flight.update({ where: { id: f.id }, data: { gate: "F1" } });
          // A statement after the failure: an aborted transaction would refuse it.
          await tx.flight.update({ where: { id: f.id }, data: { seatNumber: "9Z" } });
        });
        const stored = await prisma.flight.findUnique({ where: { id: f.id } });
        expect([stored?.gate, stored?.seatNumber]).toEqual(["F1", "9Z"]);
        const stats = ledgerStats();
        expect(kind === "insert" ? stats.insertFailures : stats.snapshotFailures).toBeGreaterThan(
          0
        );
        expect(await rowsFor(f.id)).toEqual([]);
      }
    );

    it.each(["insert", "snapshot"] as const)(
      "a %s that fails around a standalone write leaves the write done",
      async (kind) => {
        const f = await flight(userId, { gate: "A1" });
        injectLedgerFaultForTests(kind);
        await prisma.flight.update({ where: { id: f.id }, data: { gate: "S1" } });
        expect((await prisma.flight.findUnique({ where: { id: f.id } }))?.gate).toBe("S1");
        expect(await rowsFor(f.id)).toEqual([]);
      }
    );
  });

  it("drops the rows of a failed batch transaction too", async () => {
    const f = await flight(userId, { gate: "A1" });
    await expect(
      prisma.$transaction([
        prisma.flight.update({ where: { id: f.id }, data: { gate: "X1" } }),
        prisma.flight.update({
          where: { id: "00000000-0000-4000-8000-000000000000" },
          data: { gate: "Y" },
        }),
      ])
    ).rejects.toBeDefined();
    expect(await rowsFor(f.id)).toEqual([]);
    await prisma.$transaction([
      prisma.flight.update({ where: { id: f.id }, data: { gate: "X2" } }),
    ]);
    expect(await rowsFor(f.id)).toHaveLength(1);
  });

  it("keeps nothing for a write that changes nothing", async () => {
    const f = await flight(userId, { gate: "A1", price: 120 });
    await prisma.flight.update({ where: { id: f.id }, data: { gate: "A1", price: 120 } });
    await prisma.flight.updateMany({ where: { id: f.id }, data: { gate: { set: "A1" } } });
    expect(await rowsFor(f.id)).toEqual([]);
  });

  it("records a delete, with a short name of what was deleted", async () => {
    const f = await flight(userId);
    await prisma.flight.delete({ where: { id: f.id } });
    const rows = await rowsFor(f.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "delete",
      field: null,
      label: "LH400 · FRA · JFK",
      userId,
    });
  });

  it("records the rows of an updateMany, one change set per entry", async () => {
    const a = await flight(userId, { seatNumber: "1A" });
    const b = await flight(userId, { seatNumber: "2B" });
    await prisma.flight.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { seatNumber: "9C" },
    });
    const rows = [...(await rowsFor(a.id)), ...(await rowsFor(b.id))];
    expect(rows.map((r) => [r.oldValue, r.newValue])).toEqual([
      ['"1A"', '"9C"'],
      ['"2B"', '"9C"'],
    ]);
  });

  it("keeps no payload: a value over the cap is recorded as omitted, without its text", async () => {
    const f = await flight(userId, { notes: "short" });
    await prisma.flight.update({
      where: { id: f.id },
      data: { notes: "x".repeat(MAX_VALUE_CHARS + 10) },
    });
    const rows = await rowsFor(f.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      field: "notes",
      omitted: true,
      oldValue: null,
      newValue: null,
    });
  });

  it("records a change between two values too large to keep, as omitted, and no-op between equal ones", async () => {
    const big = (c: string) => c.repeat(MAX_VALUE_CHARS + 10);
    const f = await flight(userId, { notes: big("a") });
    await prisma.flight.update({ where: { id: f.id }, data: { notes: big("a") } });
    expect(await rowsFor(f.id)).toEqual([]);
    await prisma.flight.update({ where: { id: f.id }, data: { notes: big("b") } });
    const rows = await rowsFor(f.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "notes", omitted: true });
  });

  it("does not restore a field the entry's form derives others from (companions)", async () => {
    const f = await flight(userId, { companions: ["Bo"] });
    await prisma.flight.update({ where: { id: f.id }, data: { companions: ["Anna"] } });
    const [row] = await rowsFor(f.id);
    const list = await request(app)
      .get(`/api/v1/change-history?entityType=flight&entityId=${f.id}`)
      .set("Cookie", cookie);
    expect(list.body.entries[0]).toMatchObject({ field: "companions", restorable: false });
    const res = await request(app)
      .post(`/api/v1/change-history/${row.id}/restore`)
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CHANGE_NOT_RESTORABLE");
  });

  it("records nothing inside a maintenance backfill", async () => {
    const f = await flight(userId, { gate: "A1" });
    await withoutChangeLedger(() =>
      prisma.flight.update({ where: { id: f.id }, data: { gate: "Z9" } })
    );
    expect(await rowsFor(f.id)).toEqual([]);
  });

  it("restores a value: the field is written back and the restore is a row of its own", async () => {
    const f = await flight(userId, { seatNumber: "12A" });
    await prisma.flight.update({ where: { id: f.id }, data: { seatNumber: "30F" } });

    const list = await request(app)
      .get(`/api/v1/change-history?entityType=flight&entityId=${f.id}`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(1);
    const [entry] = list.body.entries;
    expect(entry).toMatchObject({
      field: "seatNumber",
      oldValue: "12A",
      newValue: "30F",
      restorable: true,
      actor: null,
    });

    const res = await request(app)
      .post(`/api/v1/change-history/${entry.id}/restore`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.restored).toHaveLength(1);
    expect(res.body.restored[0]).toMatchObject({
      field: "seatNumber",
      oldValue: "30F",
      newValue: "12A",
      restoredFromId: entry.id,
      reason: "restore",
      source: "web",
      actor: "self",
    });

    const stored = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(stored?.seatNumber).toBe("12A");
    expect(await rowsFor(f.id)).toHaveLength(2);
  });

  it("does not restore a time on its own — its derived columns would disagree", async () => {
    const f = await flight(userId, { departureTime: new Date("2026-11-02T06:00:00Z") });
    await prisma.flight.update({
      where: { id: f.id },
      data: { departureTime: new Date("2026-11-02T08:00:00Z") },
    });
    const [row] = await rowsFor(f.id);
    expect(row.oldValue).toBe(JSON.stringify("2026-11-02T06:00:00.000Z"));
    const res = await request(app)
      .post(`/api/v1/change-history/${row.id}/restore`)
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CHANGE_NOT_RESTORABLE");
  });

  it("shows another account nothing, and refuses its restore as not found", async () => {
    const f = await flight(userId, { gate: "C3" });
    await prisma.flight.update({ where: { id: f.id }, data: { gate: "D4" } });
    const [row] = await rowsFor(f.id);

    const list = await request(app)
      .get(`/api/v1/change-history?entityType=flight&entityId=${f.id}`)
      .set("Cookie", otherCookie);
    expect(list.status).toBe(200);
    expect(list.body.entries).toEqual([]);
    const all = await request(app).get("/api/v1/change-history").set("Cookie", otherCookie);
    expect(all.body.entries).toEqual([]);

    const res = await request(app)
      .post(`/api/v1/change-history/${row.id}/restore`)
      .set("Cookie", otherCookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CHANGE_NOT_FOUND");
    expect((await prisma.flight.findUnique({ where: { id: f.id } }))?.gate).toBe("D4");
  });

  it("goes with the account", async () => {
    const temp = await prisma.user.create({
      data: { username: `chlogtemp${Date.now()}`, passwordHash: "x" },
    });
    const f = await flight(temp.id, { gate: "A" });
    await prisma.flight.update({ where: { id: f.id }, data: { gate: "B" } });
    expect(await rowsFor(f.id)).toHaveLength(1);
    await prisma.user.delete({ where: { id: temp.id } });
    expect(await prisma.changeLedgerEntry.count({ where: { userId: temp.id } })).toBe(0);
  });

  it("travels in the account archive as the account's own rows, actor stripped", () => {
    expect(TABLE_POLICY.change_ledger_entries).toMatchObject({
      kind: "owner",
      column: "user_id",
      idColumns: ["entity_id"],
      strip: ["actor_user_id", "restored_from_id"],
    });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { propagateWrite } from "../../services/sharing/propagate";
import { asPropagation } from "../../services/sharing/propagationGuard";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Trip sharing S2 — acting on notices (undo, delete the own copy), consent
 * withdrawn, moving entries in and out of a shared trip, the recursion
 * guard, and the read-only booking total.
 */
describe("sharing — undo, consent, move, booking total", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let eve: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  const put = (who: TestAccount, id: string, body: object) =>
    request(app).put(`/api/v1/flights/${id}`).set("Cookie", who.cookie).send(body);
  const post = (who: TestAccount, url: string) =>
    request(app).post(`/api/v1${url}`).set("Cookie", who.cookie).send({});
  const bensFlight = () => prisma.flight.findFirstOrThrow({ where: { userId: ben.id } });
  const annasFlight = () => prisma.flight.findUniqueOrThrow({ where: { id: pair.full.flight.id } });
  const latest = (who: TestAccount) =>
    prisma.shareNotice.findFirstOrThrow({
      where: { userId: who.id },
      orderBy: { createdAt: "desc" },
    });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    eve = await makeAccount("eve");
    pair = await sharedPair(anna, ben);
    await put(anna, pair.full.flight.id, { notes: "settle" }).expect(200);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("undo restores the old value on the own copy and propagates as a change", async () => {
    await put(anna, pair.full.flight.id, { gate: "A1" }).expect(200);
    const notice = await latest(ben);

    // Nobody else may act on Ben's notice.
    await post(eve, `/sharing/notices/${notice.id}/undo`).expect(404);

    const res = await post(ben, `/sharing/notices/${notice.id}/undo`).expect(200);
    expect(res.body.data).toMatchObject({ undone: true });
    expect((await bensFlight()).gate).toBeNull();
    expect(
      (await prisma.shareNotice.findUniqueOrThrow({ where: { id: notice.id } })).undoneAt
    ).not.toBeNull();
    // Owner decision 3: the undo is Ben's change and reaches Anna, with its own notice.
    expect((await annasFlight()).gate).toBeNull();
    const back = await latest(anna);
    expect(back).toMatchObject({ kind: "updated", actorId: ben.id });
    expect(back.after).toMatchObject({ facts: { gate: null } });

    // Twice is refused.
    const again = await post(ben, `/sharing/notices/${notice.id}/undo`).expect(409);
    expect(again.body.code).toBe("SHARE_UNDO_UNAVAILABLE");
  });

  it("undo refuses with 409 SHARE_UNDO_STALE, naming the field, when the copy changed since", async () => {
    await put(anna, pair.full.flight.id, { gate: "A1" }).expect(200);
    const notice = await latest(ben);
    await put(ben, (await bensFlight()).id, { gate: "A7" }).expect(200);
    const res = await post(ben, `/sharing/notices/${notice.id}/undo`).expect(409);
    expect(res.body.code).toBe("SHARE_UNDO_STALE");
    expect(JSON.stringify(res.body)).toContain("gate");
    expect((await bensFlight()).gate).toBe("A7");
  });

  it("after a delete, 'delete mine too' removes only the own copy", async () => {
    await request(app)
      .delete(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .expect(204);
    const notice = await latest(ben);
    expect(notice.kind).toBe("deleted");
    await post(ben, `/sharing/notices/${notice.id}/delete-copy`).expect(200);
    expect(await prisma.flight.count({ where: { userId: ben.id } })).toBe(0);
    const again = await post(ben, `/sharing/notices/${notice.id}/delete-copy`).expect(409);
    expect(again.body.code).toBe("SHARE_COPY_NOT_FOUND");
  });

  it("a withdrawn consent detaches the copy: no further changes reach it", async () => {
    const consent = await prisma.shareConsent.findFirstOrThrow({
      where: { requesterId: anna.id, targetId: ben.id },
    });
    await post(ben, `/sharing/consents/${consent.id}/withdraw`).expect(200);
    const bensTrip = await prisma.trip.findUniqueOrThrow({ where: { id: pair.memberTrip.id } });
    expect(bensTrip.shareGroupId).toBeNull();
    // Anna is told Ben left.
    expect(await latest(anna)).toMatchObject({ kind: "left", actorId: ben.id });

    await put(anna, pair.full.flight.id, { gate: "Z1" }).expect(200);
    expect((await bensFlight()).gate).toBeNull();
    expect(await prisma.shareNotice.count({ where: { userId: ben.id } })).toBe(0);
  });

  it("propagation skips a member whose consent is withdrawn even if still in the group", async () => {
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "withdrawn" },
    });
    await put(anna, pair.full.flight.id, { gate: "Z2" }).expect(200);
    expect((await bensFlight()).gate).toBeNull();
  });

  it("moving an entry out clears its key and tells the others; moving it back copies it anew", async () => {
    const assign = (tripId: string, action: "add" | "remove") =>
      request(app)
        .post(`/api/v1/trips/${tripId}/flights`)
        .set("Cookie", anna.cookie)
        .send({ flightIds: [pair.full.flight.id], action })
        .expect(200);
    await assign(pair.full.trip.id, "remove");
    expect((await annasFlight()).shareKey).toBeNull();
    const out = await latest(ben);
    expect(out).toMatchObject({ kind: "deleted" });
    expect(out.after).toMatchObject({ reason: "movedOut" });

    await assign(pair.full.trip.id, "add");
    const key = (await annasFlight()).shareKey;
    expect(key).not.toBeNull();
    expect(await prisma.flight.count({ where: { userId: ben.id, shareKey: key } })).toBe(1);
    expect(await latest(ben)).toMatchObject({ kind: "created" });
  });

  it("bulk-editing a flight out of and back into the shared trip propagates like a move", async () => {
    const bulk = (trip: object) =>
      request(app)
        .post("/api/v1/flights/bulk-edit")
        .set("Cookie", anna.cookie)
        .send({ flightIds: [pair.full.flight.id], trip })
        .expect(200);
    await bulk({ mode: "clear" });
    expect((await annasFlight()).shareKey).toBeNull();
    expect((await latest(ben)).after).toMatchObject({ reason: "movedOut" });

    await bulk({ mode: "set", tripId: pair.full.trip.id });
    const key = (await annasFlight()).shareKey;
    expect(key).not.toBeNull();
    expect(await prisma.flight.count({ where: { userId: ben.id, shareKey: key } })).toBe(1);
    expect(await latest(ben)).toMatchObject({ kind: "created" });
  });

  it("a write inside a propagation does not propagate again", async () => {
    await prisma.flight.update({ where: { id: pair.full.flight.id }, data: { gate: "G9" } });
    const before = await prisma.shareNotice.count();
    await asPropagation(() => propagateWrite(prisma, anna.id, "flight", pair.full.flight.id));
    expect(await prisma.shareNotice.count()).toBe(before);
    // Nor does another account's row: Eve cannot propagate Anna's flight.
    await propagateWrite(prisma, eve.id, "flight", pair.full.flight.id);
    expect(await prisma.shareNotice.count()).toBe(before);
  });

  it("shows the other member's booking total read-only, and lists notice changes", async () => {
    await prisma.booking.create({
      data: { userId: anna.id, tripId: pair.full.trip.id, price: 980.5, currency: "EUR" },
    });
    const view = await request(app)
      .get(`/api/v1/sharing/trips/${pair.memberTrip.id}`)
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(view.body.data.bookingTotals).toEqual([
      {
        member: expect.objectContaining({ id: anna.id }),
        totals: [{ currency: "EUR", amount: 980.5 }],
      },
    ]);
    // Eve sees nothing of it.
    await request(app)
      .get(`/api/v1/sharing/trips/${pair.memberTrip.id}`)
      .set("Cookie", eve.cookie)
      .expect(404);

    await put(anna, pair.full.flight.id, { departureLocal: "2025-05-01T10:30" }).expect(200);
    const list = await request(app)
      .get("/api/v1/sharing/notices")
      .set("Cookie", ben.cookie)
      .expect(200);
    const updated = list.body.data.notices.find((n: { kind: string }) => n.kind === "updated");
    const dep = updated.changes.find((c: { field: string }) => c.field === "departureTime");
    expect(dep.after).toMatchObject({
      kind: "time",
      value: { zone: "Europe/Berlin", local: "2025-05-01T10:30:00" },
    });
  });
});

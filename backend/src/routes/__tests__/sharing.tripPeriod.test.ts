import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { acceptSuggestion } from "../../services/tripSuggestions/accept";
import type { TripSuggestion } from "../../services/tripSuggestions/types";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * forgejo#280 point 4 (owner, 2026-10-27): on a shared trip the date range
 * syncs — it is a fact, the same for everyone on the trip — and the name does
 * not: each member names their trip. A period change reaches every consenting
 * member's trip of the group at once, with an `updated` notice they can undo,
 * like an entry's facts. Until then neither synced.
 */
describe("sharing — a shared trip's period", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  const patchTrip = (who: TestAccount, id: string, body: object) =>
    request(app).patch(`/api/v1/trips/${id}`).set("Cookie", who.cookie).send(body);
  const trip = (id: string) => prisma.trip.findUniqueOrThrow({ where: { id } });
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  const notices = (who: TestAccount) =>
    prisma.shareNotice.findMany({ where: { userId: who.id }, orderBy: { createdAt: "desc" } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("moves every member's trip with the period, and tells them", async () => {
    await patchTrip(anna, pair.full.trip.id, {
      startDate: "2025-05-02",
      endDate: "2025-05-10",
    }).expect(200);

    const bens = await trip(pair.memberTrip.id);
    expect([day(bens.startDay), day(bens.endDay)]).toEqual(["2025-05-02", "2025-05-10"]);

    const [notice] = await notices(ben);
    expect(notice).toMatchObject({
      kind: "updated",
      entityType: "trip",
      entityKey: pair.memberTrip.id,
      actorId: anna.id,
    });
    const listed = await request(app)
      .get("/api/v1/sharing/notices")
      .set("Cookie", ben.cookie)
      .expect(200);
    const view = listed.body.data.notices.find((n: { id: string }) => n.id === notice.id);
    expect(view.changes.map((c: { field: string }) => c.field)).toEqual(
      expect.arrayContaining(["startDay", "endDay"])
    );
    // The writer is not told about her own change.
    expect(await notices(anna)).toHaveLength(0);
  });

  it("keeps each member's own name, and says nothing about a rename", async () => {
    await patchTrip(anna, pair.full.trip.id, { name: "Portugal mit Ben" }).expect(200);
    expect((await trip(pair.memberTrip.id)).name).toBe(pair.memberTrip.name);
    expect(await notices(ben)).toHaveLength(0);
  });

  it("an edit that leaves the period alone changes nothing on the other trips", async () => {
    await patchTrip(anna, pair.full.trip.id, {
      startDate: "2025-05-01",
      endDate: "2025-05-08",
      notes: "nur bei mir",
    }).expect(200);
    expect(await notices(ben)).toHaveLength(0);
    expect((await trip(pair.memberTrip.id)).notes).not.toBe("nur bei mir");
  });

  it("undo restores the member's period and reaches the writer as a change of its own", async () => {
    await patchTrip(anna, pair.full.trip.id, { endDate: "2025-05-12" }).expect(200);
    const [notice] = await notices(ben);

    await request(app)
      .post(`/api/v1/sharing/notices/${notice.id}/undo`)
      .set("Cookie", ben.cookie)
      .send({})
      .expect(200);

    expect(day((await trip(pair.memberTrip.id)).endDay)).toBe("2025-05-08");
    expect(day((await trip(pair.full.trip.id)).endDay)).toBe("2025-05-08");
    const [back] = await notices(anna);
    expect(back).toMatchObject({ kind: "updated", entityType: "trip", actorId: ben.id });
  });

  it("undo refuses with SHARE_UNDO_STALE when the member moved the period since", async () => {
    await patchTrip(anna, pair.full.trip.id, { endDate: "2025-05-12" }).expect(200);
    const [notice] = await notices(ben);
    await patchTrip(ben, pair.memberTrip.id, { endDate: "2025-05-14" }).expect(200);

    const res = await request(app)
      .post(`/api/v1/sharing/notices/${notice.id}/undo`)
      .set("Cookie", ben.cookie)
      .send({})
      .expect(409);
    expect(res.body.code).toBe("SHARE_UNDO_STALE");
    expect(day((await trip(pair.memberTrip.id)).endDay)).toBe("2025-05-14");
  });

  it("does not reach a member whose consent is withdrawn", async () => {
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "withdrawn" },
    });
    await patchTrip(anna, pair.full.trip.id, { endDate: "2025-05-12" }).expect(200);
    expect(day((await trip(pair.memberTrip.id)).endDay)).toBe("2025-05-08");
    expect(await notices(ben)).toHaveLength(0);
  });

  it("an accepted 'extend the trip' suggestion moves the period for everyone too", async () => {
    const proposal = {
      id: "extend-test",
      kind: "extend",
      startDay: "2025-05-01",
      endDay: "2025-05-11",
      nights: 10,
      planned: false,
      destination: null,
      signals: [],
      zoneUnknown: 0,
      members: [],
      trip: { id: pair.full.trip.id },
      newSpan: { startDay: "2025-05-01", endDay: "2025-05-11" },
    } as unknown as TripSuggestion;
    await acceptSuggestion(anna.id, proposal, {});
    expect(day((await trip(pair.memberTrip.id)).endDay)).toBe("2025-05-11");
    expect((await notices(ben))[0]).toMatchObject({ kind: "updated", entityType: "trip" });
  });
});

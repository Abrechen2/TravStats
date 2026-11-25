import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import { SHARE_ENTITIES } from "../../services/sharing/shareTypes";
import { keyedDelegate } from "../../services/sharing/keyOps";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * forgejo#440: two accounts that already hold the same trip are linked instead of copied. The
 * acceptance: the dry run reports a different stay count, the link writes share keys only, a later
 * fact change propagates, nothing is duplicated, a repeat is a no-op and leaving undoes it.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function rowCount(userId: string): Promise<number> {
  let n = 0;
  for (const entity of SHARE_ENTITIES) {
    n += (
      await keyedDelegate(prisma, entity).findMany({
        where: entity === "stop" ? { trip: { userId } } : { userId },
        select: { id: true, shareKey: true },
      })
    ).length;
  }
  return n;
}

describe("linking an existing copy (forgejo#440)", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annas: Awaited<ReturnType<typeof makeFullTrip>>;
  let bens: Awaited<ReturnType<typeof makeFullTrip>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    annas = await makeFullTrip(anna);
    bens = await makeFullTrip(ben);
    // Ben slept one night more somewhere else: a second stay only he holds.
    const house = await prisma.lodging.create({
      data: { userId: ben.id, name: "Pestana Vintage", city: "Porto", country: "PT" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: ben.id,
        tripId: bens.trip.id,
        lodgingId: house.id,
        checkIn: day("2025-05-06"),
        checkOut: day("2025-05-07"),
        checkInDate: day("2025-05-06"),
        checkOutDate: day("2025-05-07"),
        stayZone: "Europe/Lisbon",
        status: "completed",
      },
    });
    // Ben's flight left later on the same day: a differing fact.
    await prisma.flight.update({
      where: { id: bens.flight.id },
      data: { departureTime: new Date("2025-05-01T08:30:00.000Z") },
    });
    await linkWithConsent(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const preview = () =>
    request(app)
      .post(`/api/v1/sharing/trips/${annas.trip.id}/link-preview`)
      .set("Cookie", anna.cookie)
      .send({ userId: ben.id, targetTripId: bens.trip.id });
  const link = (decision: string) =>
    request(app)
      .post(`/api/v1/sharing/trips/${annas.trip.id}/link`)
      .set("Cookie", anna.cookie)
      .send({ userId: ben.id, targetTripId: bens.trip.id, decision });

  it("offers Ben's trip with the same period as the candidate", async () => {
    const res = await request(app)
      .get(`/api/v1/sharing/trips/${annas.trip.id}/link-candidates`)
      .query({ userId: ben.id })
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(res.body.data).toEqual({
      candidates: [expect.objectContaining({ id: bens.trip.id, reason: "period" })],
      possibleCopy: true,
    });
  });

  it("the dry run reports the different stay count and the differing departure, writing nothing", async () => {
    const before = await rowCount(ben.id);
    const res = await preview().expect(200);
    const data = res.body.data;
    expect(data.redacted).toBe(false);
    expect(data.byType).toContainEqual({
      entity: "lodgingStay",
      here: 1,
      there: 2,
      matched: 1,
      differing: 0,
    });
    expect(data.onlyThere).toEqual([expect.objectContaining({ entity: "lodgingStay" })]);
    expect(data.onlyHere).toEqual([]);
    const flight = data.matched.find((m: { entity: string }) => m.entity === "flight");
    expect(flight.conflicts.map((c: { field: string }) => c.field)).toContain("departureTime");
    expect(data.counts.matched).toBe(data.matched.length);
    // Nothing written: no group, no key on either side.
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: annas.trip.id } })).shareGroupId
    ).toBeNull();
    expect(await prisma.flight.count({ where: { userId: anna.id, shareKey: { not: null } } })).toBe(
      0
    );
    expect(await rowCount(ben.id)).toBe(before);
  });

  it("links by keys only: one group, one key per pair, no entry created on either side", async () => {
    const annaBefore = await rowCount(anna.id);
    const benBefore = await rowCount(ben.id);
    const res = await link("both").expect(200);
    expect(res.body.data).toMatchObject({ onlyHere: 0, onlyThere: 1, skipped: 0, settled: 0 });
    expect(await rowCount(anna.id)).toBe(annaBefore);
    expect(await rowCount(ben.id)).toBe(benBefore);
    const [a, b] = await Promise.all([
      prisma.trip.findUniqueOrThrow({ where: { id: annas.trip.id } }),
      prisma.trip.findUniqueOrThrow({ where: { id: bens.trip.id } }),
    ]);
    expect(a.shareGroupId).not.toBeNull();
    expect(b.shareGroupId).toBe(a.shareGroupId);
    const [fa, fb] = await Promise.all([
      prisma.flight.findUniqueOrThrow({ where: { id: annas.flight.id } }),
      prisma.flight.findUniqueOrThrow({ where: { id: bens.flight.id } }),
    ]);
    expect(fa.shareKey).not.toBeNull();
    expect(fb.shareKey).toBe(fa.shareKey);
    // "both": each keeps their own departure.
    expect(fb.departureTime.toISOString()).toBe("2025-05-01T08:30:00.000Z");
    // The stay only Ben holds stays his, unkeyed.
    expect(await prisma.lodgingStay.count({ where: { userId: ben.id, shareKey: null } })).toBe(1);
    expect(res.body.data.alreadyLinked).toBe(0);
  });

  it("a later fact change propagates to the linked copy, and a repeat links nothing twice", async () => {
    await link("both").expect(200);
    const snap = await shareSnapshot(prisma, "rail", annas.rail.id);
    await prisma.railJourney.update({
      where: { id: annas.rail.id },
      data: { trainNumber: "999" },
    });
    await propagateWrite(prisma, anna.id, "rail", annas.rail.id, snap);
    expect(
      (await prisma.railJourney.findUniqueOrThrow({ where: { id: bens.rail.id } })).trainNumber
    ).toBe("999");

    const again = await link("both").expect(200);
    expect(again.body.data.linked).toBe(0);
    expect(again.body.data.alreadyLinked).toBeGreaterThan(0);
    expect(await prisma.railJourney.count({ where: { userId: ben.id } })).toBe(1);
  });

  it("'mine' writes Anna's departure onto Ben's flight with an undoable notice", async () => {
    await link("mine").expect(200);
    const fb = await prisma.flight.findUniqueOrThrow({ where: { id: bens.flight.id } });
    expect(fb.departureTime.toISOString()).toBe("2025-05-01T08:00:00.000Z");
    expect(
      await prisma.shareNotice.count({ where: { userId: ben.id, kind: "updated" } })
    ).toBeGreaterThan(0);
  });

  it("'theirs' writes Ben's departure onto Anna's flight", async () => {
    await link("theirs").expect(200);
    const fa = await prisma.flight.findUniqueOrThrow({ where: { id: annas.flight.id } });
    expect(fa.departureTime.toISOString()).toBe("2025-05-01T08:30:00.000Z");
  });

  it("leaving the group undoes the link: the keys are gone, both trips stay", async () => {
    await link("both").expect(200);
    await request(app)
      .post(`/api/v1/sharing/trips/${bens.trip.id}/leave`)
      .set("Cookie", ben.cookie)
      .expect(200);
    const b = await prisma.trip.findUniqueOrThrow({ where: { id: bens.trip.id } });
    expect(b.shareGroupId).toBeNull();
    expect(await prisma.flight.count({ where: { userId: ben.id, shareKey: { not: null } } })).toBe(
      0
    );
  });

  it("without any request to Ben nothing is previewed", async () => {
    await prisma.shareConsent.deleteMany({ where: { targetId: ben.id } });
    await preview().expect(403);
  });

  it("Anna's own pending request grants nothing: no candidates, no dry run", async () => {
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "pending", decidedAt: null },
    });
    await request(app)
      .get(`/api/v1/sharing/trips/${annas.trip.id}/link-candidates`)
      .query({ userId: ben.id })
      .set("Cookie", anna.cookie)
      .expect(403);
    await preview().expect(403);
  });

  it("when Ben has asked but not agreed: only 'a copy may exist' and aggregate numbers, nothing of his", async () => {
    await prisma.shareConsent.deleteMany({ where: { requesterId: anna.id, targetId: ben.id } });
    await prisma.shareConsent.create({
      data: { requesterId: ben.id, targetId: anna.id, status: "pending" },
    });
    const candidates = await request(app)
      .get(`/api/v1/sharing/trips/${annas.trip.id}/link-candidates`)
      .query({ userId: ben.id })
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(candidates.body.data).toEqual({ candidates: [], possibleCopy: true });
    // No trip id to name: the server picks the candidate, and ignores an id sent anyway.
    const data = (
      await request(app)
        .post(`/api/v1/sharing/trips/${annas.trip.id}/link-preview`)
        .set("Cookie", anna.cookie)
        .send({ userId: ben.id })
        .expect(200)
    ).body.data;
    expect(data.redacted).toBe(true);
    expect(data.there).toEqual({ id: "", name: "", startDay: null, endDay: null });
    expect(data.byType).toEqual([]);
    expect(data.matched).toEqual([]);
    expect(data.onlyThere).toEqual([]);
    expect(data.counts).toMatchObject({ onlyThere: null, conflicting: 1 });
    expect(data.counts.matched).toBeGreaterThan(0);
    const body = JSON.stringify(data);
    expect(body).not.toContain(bens.trip.id);
    expect(body).not.toContain("Pestana");
    // And no link without his yes.
    await link("both").expect(403);
  });
});

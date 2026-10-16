import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  sharedPair,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Owner decision 2026-10-16: a member may not bring a third account into a
 * share group on their own consent alone. Joining a group hands the newcomer
 * write access into every member's copy, so the newcomer needs an ACCEPTED
 * consent with every current member — and propagation reaches only members
 * with an accepted consent with the writer.
 */
describe("sharing — onward sharing needs everyone's consent", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let carl: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    carl = await makeAccount("carl");
    pair = await sharedPair(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const share = (as: TestAccount, tripId: string, companionId: string) =>
    request(app)
      .post(`/api/v1/sharing/trips/${tripId}/share`)
      .set("Cookie", as.cookie)
      .send({ companionId });

  it("refuses Ben sharing his copy on to Carl when Anna and Carl never agreed", async () => {
    const bensCarl = await linkWithConsent(ben, carl);
    const res = await share(ben, pair.memberTrip.id, bensCarl.id).expect(403);
    expect(res.body.code).toBe("SHARE_GROUP_CONSENT_REQUIRED");
    expect(await prisma.trip.count({ where: { userId: carl.id } })).toBe(0);
    expect(await prisma.flight.count({ where: { userId: carl.id } })).toBe(0);
  });

  it("lets Ben share on once Anna and Carl have an accepted consent", async () => {
    const bensCarl = await linkWithConsent(ben, carl);
    await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: carl.id, status: "accepted", decidedAt: new Date() },
    });
    await share(ben, pair.memberTrip.id, bensCarl.id).expect(200);
    const carlsTrip = await prisma.trip.findFirstOrThrow({ where: { userId: carl.id } });
    expect(carlsTrip.shareGroupId).toBe(pair.groupId);
  });

  it("propagates no write to a member who has no accepted consent with the writer", async () => {
    // Carl joined with Anna's consent, which is gone again without a
    // withdrawal (a row deleted, as in any group that predates the rule).
    const bensCarl = await linkWithConsent(ben, carl);
    const annaCarl = await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: carl.id, status: "accepted", decidedAt: new Date() },
    });
    await share(ben, pair.memberTrip.id, bensCarl.id).expect(200);
    await prisma.shareConsent.delete({ where: { id: annaCarl.id } });

    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ gate: "Z9" })
      .expect(200);

    const carlsFlight = await prisma.flight.findFirstOrThrow({ where: { userId: carl.id } });
    const bensFlight = await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bensFlight.gate).toBe("Z9");
    expect(carlsFlight.gate).toBeNull();
    expect(await prisma.shareNotice.count({ where: { userId: carl.id, actorId: anna.id } })).toBe(
      0
    );
  });
});

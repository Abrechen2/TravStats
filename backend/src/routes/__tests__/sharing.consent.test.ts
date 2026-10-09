import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * Trip sharing S1 — consent and companion link (design 2026-10-09, decision 4):
 * nothing reaches another account without that account's yes, and nobody can
 * answer, see or withdraw a consent that is not theirs.
 */
describe("sharing — consent lifecycle", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let eve: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    eve = await makeAccount("eve");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const ask = (from: TestAccount, username: string) =>
    request(app).post("/api/v1/sharing/consents").set("Cookie", from.cookie).send({ username });

  it("rejects an unauthenticated request", async () => {
    await request(app).get("/api/v1/sharing/consents").expect(401);
  });

  it("asks, shows the request to the target and in its inbox count, and accepts", async () => {
    const asked = await ask(anna, ben.username).expect(201);
    expect(asked.body.success).toBe(true);
    expect(asked.body.data.status).toBe("pending");
    expect(asked.body.data.person).toMatchObject({ id: ben.id, displayName: "ben" });

    const benList = await request(app)
      .get("/api/v1/sharing/consents")
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(benList.body.data.incoming).toHaveLength(1);
    expect(benList.body.data.incoming[0].person.id).toBe(anna.id);

    const count = await request(app)
      .get("/api/v1/sharing/inbox/count")
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(count.body.data.count).toBe(1);

    const accepted = await request(app)
      .post(`/api/v1/sharing/consents/${asked.body.data.id}/accept`)
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(accepted.body.data.status).toBe("accepted");
    expect(accepted.body.data.decidedAt).not.toBeNull();

    const after = await request(app)
      .get("/api/v1/sharing/inbox/count")
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(after.body.data.count).toBe(0);
  });

  it("matches the username case-insensitively", async () => {
    await ask(anna, ben.username.toUpperCase()).expect(201);
  });

  it("refuses an unknown user, oneself and a duplicate with stable codes", async () => {
    expect((await ask(anna, "share-test-nobody").expect(404)).body.code).toBe(
      "SHARE_USER_NOT_FOUND"
    );
    expect((await ask(anna, anna.username).expect(400)).body.code).toBe("SHARE_SELF");
    await ask(anna, ben.username).expect(201);
    const twice = await ask(anna, ben.username).expect(409);
    expect(twice.body.code).toBe("SHARE_CONSENT_DUPLICATE");
    expect(twice.body.status).toBe("pending");
  });

  it("does not find a deactivated account", async () => {
    await prisma.user.update({ where: { id: ben.id }, data: { isActive: false } });
    expect((await ask(anna, ben.username).expect(404)).body.code).toBe("SHARE_USER_NOT_FOUND");
  });

  it("declines, and a declined pair may be asked again", async () => {
    const asked = await ask(anna, ben.username).expect(201);
    const declined = await request(app)
      .post(`/api/v1/sharing/consents/${asked.body.data.id}/decline`)
      .set("Cookie", ben.cookie)
      .expect(200);
    expect(declined.body.data.status).toBe("declined");
    const again = await ask(anna, ben.username).expect(201);
    expect(again.body.data.status).toBe("pending");
    expect(again.body.data.id).toBe(asked.body.data.id);
  });

  it("refuses a second answer", async () => {
    const asked = await ask(anna, ben.username).expect(201);
    const url = `/api/v1/sharing/consents/${asked.body.data.id}`;
    await request(app).post(`${url}/accept`).set("Cookie", ben.cookie).expect(200);
    const second = await request(app).post(`${url}/decline`).set("Cookie", ben.cookie).expect(409);
    expect(second.body.code).toBe("SHARE_CONSENT_NOT_PENDING");
  });

  it("lets only the asked account answer — the asker and a stranger get 404", async () => {
    const asked = await ask(anna, ben.username).expect(201);
    const url = `/api/v1/sharing/consents/${asked.body.data.id}/accept`;
    expect((await request(app).post(url).set("Cookie", anna.cookie).expect(404)).body.code).toBe(
      "SHARE_CONSENT_NOT_FOUND"
    );
    expect((await request(app).post(url).set("Cookie", eve.cookie).expect(404)).body.code).toBe(
      "SHARE_CONSENT_NOT_FOUND"
    );
    const row = await prisma.shareConsent.findUniqueOrThrow({ where: { id: asked.body.data.id } });
    expect(row.status).toBe("pending");
  });

  it("lets either side withdraw, but not a stranger", async () => {
    const asked = await ask(anna, ben.username).expect(201);
    const url = `/api/v1/sharing/consents/${asked.body.data.id}/withdraw`;
    await request(app).post(url).set("Cookie", eve.cookie).expect(404);
    const byTarget = await request(app).post(url).set("Cookie", ben.cookie).expect(200);
    expect(byTarget.body.data.status).toBe("withdrawn");
    expect(byTarget.body.data.person.id).toBe(anna.id);
  });

  it("never lists another pair's consents", async () => {
    await ask(anna, ben.username).expect(201);
    const evesView = await request(app)
      .get("/api/v1/sharing/consents")
      .set("Cookie", eve.cookie)
      .expect(200);
    expect(evesView.body.data).toEqual({ incoming: [], outgoing: [] });
  });
});

describe("sharing — linking a companion to an account", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let eve: TestAccount;
  let companionId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    eve = await makeAccount("eve");
    const companion = await prisma.companion.create({
      data: { userId: anna.id, canonicalName: "ben", displayName: "Ben", searchName: "ben" },
    });
    companionId = companion.id;
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
  });

  const link = (as: TestAccount, id: string, userId: string) =>
    request(app)
      .put(`/api/v1/sharing/companions/${id}/link`)
      .set("Cookie", as.cookie)
      .send({ userId });

  it("refuses without an accepted consent from that account", async () => {
    const refused = await link(anna, companionId, ben.id).expect(403);
    expect(refused.body.code).toBe("SHARE_CONSENT_REQUIRED");

    // A pending request is not a yes, and neither is a consent the OTHER way round.
    await prisma.shareConsent.create({ data: { requesterId: anna.id, targetId: ben.id } });
    await prisma.shareConsent.create({
      data: { requesterId: ben.id, targetId: anna.id, status: "accepted" },
    });
    expect((await link(anna, companionId, ben.id).expect(403)).body.code).toBe(
      "SHARE_CONSENT_REQUIRED"
    );
    const row = await prisma.companion.findUniqueOrThrow({ where: { id: companionId } });
    expect(row.linkedUserId).toBeNull();
  });

  it("links with an accepted consent, lists it and unlinks", async () => {
    await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: ben.id, status: "accepted" },
    });
    const linked = await link(anna, companionId, ben.id).expect(200);
    expect(linked.body.data.linkedUser.id).toBe(ben.id);

    const list = await request(app)
      .get("/api/v1/sharing/companions")
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(list.body.data.companions[0].linkedUser.username).toBe(ben.username);
    expect(list.body.data.linkableUsers.map((u: { id: string }) => u.id)).toEqual([ben.id]);

    await request(app)
      .delete(`/api/v1/sharing/companions/${companionId}/link`)
      .set("Cookie", anna.cookie)
      .expect(200);
    const row = await prisma.companion.findUniqueOrThrow({ where: { id: companionId } });
    expect(row.linkedUserId).toBeNull();
  });

  it("refuses a second companion for the same account", async () => {
    await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: ben.id, status: "accepted" },
    });
    await link(anna, companionId, ben.id).expect(200);
    const second = await prisma.companion.create({
      data: { userId: anna.id, canonicalName: "benny", displayName: "Benny", searchName: "benny" },
    });
    const refused = await link(anna, second.id, ben.id).expect(409);
    expect(refused.body.code).toBe("SHARE_COMPANION_ALREADY_LINKED");
  });

  it("refuses linking another account's companion", async () => {
    await prisma.shareConsent.create({
      data: { requesterId: eve.id, targetId: ben.id, status: "accepted" },
    });
    const refused = await link(eve, companionId, ben.id).expect(404);
    expect(refused.body.code).toBe("COMPANION_NOT_FOUND");
    await request(app)
      .delete(`/api/v1/sharing/companions/${companionId}/link`)
      .set("Cookie", eve.cookie)
      .expect(404);
  });

  it("refuses linking a companion to oneself", async () => {
    expect((await link(anna, companionId, anna.id).expect(400)).body.code).toBe("SHARE_SELF");
  });
});

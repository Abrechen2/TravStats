import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";

/**
 * Permanent removal of old API tokens / paired phones. Revoking only soft-deletes,
 * so revoked keys and unpaired phones piled up in both lists. Removal must never
 * cut off a working token, and must not leak or touch another account's rows.
 */
const PREFIX = "tokpurge-";
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function user(name: string): Promise<{ id: string; cookie: string }> {
  const u = await prisma.user.create({ data: { username: `${PREFIX}${name}`, passwordHash: "x" } });
  return { id: u.id, cookie: `auth_token=${generateToken(u.id)}` };
}

async function token(
  userId: string,
  label: string,
  extra: { revokedAt?: Date; expiresAt?: Date; deviceId?: string } = {}
): Promise<string> {
  const gen = await generateApiToken();
  const row = await prisma.apiToken.create({
    data: { userId, label, lookupHash: gen.lookupHash, hash: gen.hash, ...extra },
  });
  return row.id;
}

describe("DELETE /settings/tokens/:id/purge and POST /settings/tokens/purge-old", () => {
  let a: { id: string; cookie: string };
  let b: { id: string; cookie: string };

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    a = await user("a");
    b = await user("b");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  });

  const list = async (cookie: string): Promise<string[]> =>
    (await request(app).get("/api/v1/settings/tokens").set("Cookie", cookie)).body.tokens.map(
      (t: { id: string }) => t.id
    );

  it("removes a revoked token for good, so it is gone from the list", async () => {
    const id = await token(a.id, "old", { revokedAt: PAST });
    const res = await request(app)
      .delete(`/api/v1/settings/tokens/${id}/purge`)
      .set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 1 });
    expect(await list(a.cookie)).not.toContain(id);
  });

  it("removes an expired token that was never revoked", async () => {
    const id = await token(a.id, "expired", { expiresAt: PAST });
    const res = await request(app)
      .delete(`/api/v1/settings/tokens/${id}/purge`)
      .set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(await prisma.apiToken.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses an active token with TOKEN_STILL_ACTIVE and keeps it", async () => {
    const plain = await token(a.id, "live");
    const future = await token(a.id, "live-dated", { expiresAt: FUTURE });
    for (const id of [plain, future]) {
      const res = await request(app)
        .delete(`/api/v1/settings/tokens/${id}/purge`)
        .set("Cookie", a.cookie);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "TOKEN_STILL_ACTIVE" });
      expect(await prisma.apiToken.findUnique({ where: { id } })).not.toBeNull();
    }
  });

  it("answers 404 for another account's token and leaves it alone", async () => {
    const id = await token(b.id, "theirs", { revokedAt: PAST });
    const res = await request(app)
      .delete(`/api/v1/settings/tokens/${id}/purge`)
      .set("Cookie", a.cookie);
    expect(res.status).toBe(404);
    expect(await prisma.apiToken.findUnique({ where: { id } })).not.toBeNull();
  });

  it("bulk-removes only the caller's revoked and expired tokens", async () => {
    const revoked = await token(a.id, "r", { revokedAt: PAST, deviceId: "phone-1" });
    const expired = await token(a.id, "e", { expiresAt: PAST });
    const active = await token(a.id, "live");
    const activePhone = await token(a.id, "phone", { deviceId: "phone-2" });
    const foreign = await token(b.id, "theirs", { revokedAt: PAST });
    const res = await request(app)
      .post("/api/v1/settings/tokens/purge-old")
      .set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 2 });
    const left = await list(a.cookie);
    expect(left.sort()).toEqual([active, activePhone].sort());
    expect(left).not.toContain(revoked);
    expect(left).not.toContain(expired);
    expect(await prisma.apiToken.findUnique({ where: { id: foreign } })).not.toBeNull();
  });

  it("with ?devices=1 removes only old phones and leaves old script keys", async () => {
    const phone = await token(a.id, "phone", { revokedAt: PAST, deviceId: "p1" });
    const script = await token(a.id, "script", { revokedAt: PAST });
    const res = await request(app)
      .post("/api/v1/settings/tokens/purge-old?devices=1")
      .set("Cookie", a.cookie);
    expect(res.body).toEqual({ removed: 1 });
    expect(await prisma.apiToken.findUnique({ where: { id: phone } })).toBeNull();
    expect(await prisma.apiToken.findUnique({ where: { id: script } })).not.toBeNull();
  });

  it("answers removed: 0 when nothing is old", async () => {
    await token(a.id, "live");
    const res = await request(app)
      .post("/api/v1/settings/tokens/purge-old")
      .set("Cookie", a.cookie);
    expect(res.body).toEqual({ removed: 0 });
  });

  // The FK cascade deletes a calendar feed with its issuing token. That is only
  // acceptable because a feed whose issuer is revoked/expired is already dead
  // (issuerAlive); pin that, and that no OTHER feed is touched.
  it("takes only the already-dead feed of a removed device token, never a live one", async () => {
    const dead = await token(a.id, "phone", { revokedAt: PAST, deviceId: "p1" });
    await prisma.calendarFeed.create({
      data: { userId: a.id, tokenHash: "h-dead", issuedByApiTokenId: dead },
    });
    await token(b.id, "other-old", { revokedAt: PAST });
    const live = await token(b.id, "other-phone", { deviceId: "p2" });
    await prisma.calendarFeed.create({
      data: { userId: b.id, tokenHash: "h-live", issuedByApiTokenId: live },
    });
    await request(app).post("/api/v1/settings/tokens/purge-old").set("Cookie", a.cookie);
    await request(app).post("/api/v1/settings/tokens/purge-old").set("Cookie", b.cookie);
    expect(await prisma.calendarFeed.findUnique({ where: { userId: a.id } })).toBeNull();
    expect(await prisma.calendarFeed.findUnique({ where: { userId: b.id } })).not.toBeNull();
  });

  it("keeps a browser-issued feed when an old device token is removed", async () => {
    await prisma.calendarFeed.create({ data: { userId: a.id, tokenHash: "h-browser" } });
    const id = await token(a.id, "phone", { revokedAt: PAST, deviceId: "p1" });
    await request(app).delete(`/api/v1/settings/tokens/${id}/purge`).set("Cookie", a.cookie);
    expect(await prisma.calendarFeed.findUnique({ where: { userId: a.id } })).not.toBeNull();
  });
});

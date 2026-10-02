import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { encryptApiKey } from "../../../utils/encryption";

describe("admin push relay settings (/api/v1/admin/push)", () => {
  let adminUser: { id: string };
  let cookie: string;
  let rowId: number;

  beforeAll(async () => {
    adminUser = await prisma.user.create({
      data: {
        username: `admin-push-test-${Date.now()}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    cookie = `auth_token=${generateToken(adminUser.id)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        pushEnabled: false,
        pushConsentAt: null,
        pushRelayUrl: "https://push.travstats.de",
        pushInstanceId: null,
        pushInstanceSecret: null,
        pushPausedUntil: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        pushEnabled: false,
        pushConsentAt: null,
        pushInstanceId: null,
        pushInstanceSecret: null,
      },
    });
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  const get = () => request(app).get("/api/v1/admin/push").set("Cookie", cookie);
  const put = (body: object) =>
    request(app).put("/api/v1/admin/push").set("Cookie", cookie).send(body);

  it("requires an admin", async () => {
    expect((await request(app).get("/api/v1/admin/push")).status).toBe(401);
  });

  it("is off by default and shows the default relay", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pushEnabled: false,
      pushRelayUrl: "https://push.travstats.de",
      registered: false,
      pausedUntil: null,
      consentAt: null,
    });
  });

  it("never returns the secret or its ciphertext, only registered: true", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { pushInstanceId: "inst-1", pushInstanceSecret: encryptApiKey("s3cr3t-value") },
    });
    const res = await get();
    expect(res.body.registered).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("s3cr3t-value");
    expect(text).not.toContain("pushInstanceSecret");
    expect(text).not.toContain("inst-1");
  });

  it("is not registered when only one half of the credentials exists", async () => {
    await prisma.adminSettings.update({ where: { id: rowId }, data: { pushInstanceId: "x" } });
    expect((await get()).body.registered).toBe(false);
  });

  it("switching on records the consent time", async () => {
    const before = Date.now();
    const res = await put({ pushEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.pushEnabled).toBe(true);
    expect(new Date(res.body.consentAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.pushEnabled).toBe(true);
    expect(row.pushConsentAt).not.toBeNull();
  });

  it("saving again while on keeps the original consent time", async () => {
    const first = await put({ pushEnabled: true });
    const second = await put({ pushEnabled: true });
    expect(second.body.consentAt).toBe(first.body.consentAt);
  });

  it("switching off clears the credentials and the consent record", async () => {
    await put({ pushEnabled: true });
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { pushInstanceId: "inst-1", pushInstanceSecret: encryptApiKey("s") },
    });
    const res = await put({ pushEnabled: false });
    expect(res.body).toMatchObject({ pushEnabled: false, registered: false, consentAt: null });
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.pushInstanceId).toBeNull();
    expect(row.pushInstanceSecret).toBeNull();
    expect(row.pushConsentAt).toBeNull();
  });

  it("accepts https and localhost http relay addresses, dropping a trailing slash", async () => {
    for (const [input, stored] of [
      ["https://relay.example.org/", "https://relay.example.org"],
      ["http://localhost:8787", "http://localhost:8787"],
      ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
    ]) {
      const res = await put({ pushRelayUrl: input });
      expect(res.status).toBe(200);
      expect(res.body.pushRelayUrl).toBe(stored);
    }
  });

  it.each([
    "http://relay.example.org",
    "ftp://relay.example.org",
    "http://localhost.evil.com",
    "https://",
    "not a url",
    "https://user:pw@relay.example.org",
  ])("rejects the relay address %s with 400", async (bad) => {
    const res = await put({ pushRelayUrl: bad });
    expect(res.status).toBe(400);
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.pushRelayUrl).toBe("https://push.travstats.de");
  });

  it("a changed relay address drops the credentials issued by the old relay", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { pushInstanceId: "inst-1", pushInstanceSecret: encryptApiKey("s") },
    });
    const res = await put({ pushRelayUrl: "https://relay.example.org" });
    expect(res.body.registered).toBe(false);
  });

  it("an unchanged relay address keeps the credentials", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { pushInstanceId: "inst-1", pushInstanceSecret: encryptApiKey("s") },
    });
    const res = await put({ pushRelayUrl: "https://push.travstats.de/" });
    expect(res.body.registered).toBe(true);
  });

  it("POST /reset clears id and secret and the pause, keeps the switch", async () => {
    await put({ pushEnabled: true });
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        pushInstanceId: "inst-1",
        pushInstanceSecret: encryptApiKey("s"),
        pushPausedUntil: new Date(Date.now() + 3600_000),
      },
    });
    const res = await request(app).post("/api/v1/admin/push/reset").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pushEnabled: true, registered: false, pausedUntil: null });
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.pushInstanceId).toBeNull();
    expect(row.pushInstanceSecret).toBeNull();
  });

  it("switching off also clears a pause", async () => {
    await put({ pushEnabled: true });
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { pushPausedUntil: new Date(Date.now() + 3600_000) },
    });
    expect((await put({ pushEnabled: false })).body.pausedUntil).toBeNull();
  });

  it("answers 403 to a logged-in non-admin on GET, PUT and reset", async () => {
    const user = await prisma.user.create({
      data: {
        username: `plain-push-test-${Date.now()}`,
        passwordHash: await hashPassword("user-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    try {
      const c = `auth_token=${generateToken(user.id)}`;
      const base = () => ({ get: request(app).get("/api/v1/admin/push") });
      expect((await base().get.set("Cookie", c)).status).toBe(403);
      expect(
        (await request(app).put("/api/v1/admin/push").set("Cookie", c).send({ pushEnabled: true }))
          .status
      ).toBe(403);
      expect((await request(app).post("/api/v1/admin/push/reset").set("Cookie", c)).status).toBe(
        403
      );
      const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
      expect(row.pushEnabled).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("rejects a non-boolean pushEnabled", async () => {
    expect((await put({ pushEnabled: "yes" })).status).toBe(400);
  });
});

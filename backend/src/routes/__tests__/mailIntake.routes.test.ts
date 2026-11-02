import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encrypt } from "../../utils/encryption";
import { DEMO_USERNAME } from "../../utils/sharedDemo";
import { updatePolicy } from "../../services/externalServices/policy";

describe("mail intake routes (forgejo#313)", () => {
  const prefix = `mir-${Date.now()}`;
  let userId: string;
  let adminId: string;
  let cookie: string;
  let adminCookie: string;
  let demoCookie: string;

  const body = {
    host: "93.184.216.34",
    port: 993,
    tlsMode: "tls",
    username: "me@example.org",
    password: "secret-pw",
    folder: "TravStats",
  };
  const instanceBody = {
    ...body,
    username: "trips@example.org",
    address: "trips@example.org",
    folder: "INBOX",
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (
      await prisma.user.create({ data: { username: `${prefix}-u`, passwordHash, isActive: true } })
    ).id;
    adminId = (
      await prisma.user.create({
        data: { username: `${prefix}-a`, passwordHash, isActive: true, isAdmin: true },
      })
    ).id;
    const demo =
      (await prisma.user.findFirst({ where: { username: DEMO_USERNAME } })) ??
      (await prisma.user.create({
        data: { username: DEMO_USERNAME, passwordHash, isActive: true, isDemo: true },
      }));
    cookie = `auth_token=${generateToken(userId)}`;
    adminCookie = `auth_token=${generateToken(adminId)}`;
    demoCookie = `auth_token=${generateToken(demo.id)}`;
  });

  beforeEach(async () => {
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.mailIntakeAddress.deleteMany({});
    await prisma.mailIntakeSender.deleteMany({});
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "mailIntake") }));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  });

  it("requires a login", async () => {
    expect((await request(app).get("/api/v1/mail-intake")).status).toBe(401);
  });

  it("starts empty and off — nothing is configured, nothing runs", async () => {
    const res = await request(app).get("/api/v1/mail-intake").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      off: null,
      source: null,
      address: null,
      forwardingAvailable: false,
    });
  });

  it("saves a folder switched off by default and never echoes the password", async () => {
    const res = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", cookie)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, hasPassword: true, folder: "TravStats" });
    expect(JSON.stringify(res.body)).not.toContain("secret-pw");
    const stored = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { userId } });
    expect(stored.passwordEncrypted).toBeTruthy();
    expect(stored.passwordEncrypted).not.toContain("secret-pw");
  });

  it("keeps the stored password when a later save omits it, and refuses a new one without", async () => {
    await request(app).put("/api/v1/mail-intake/source").set("Cookie", cookie).send(body);
    const { password: _omit, ...withoutPassword } = body;
    const again = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", cookie)
      .send({ ...withoutPassword, enabled: true });
    expect(again.body).toMatchObject({ enabled: true, hasPassword: true });
    await prisma.mailIntakeSource.deleteMany({});
    const fresh = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", cookie)
      .send(withoutPassword);
    expect(fresh.status).toBe(400);
  });

  it("refuses plain IMAP for a personal folder (a typo must not look like a save)", async () => {
    const res = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", cookie)
      .send({ ...body, tlsMode: "none" });
    expect(res.status).toBe(400);
  });

  it("answers 409 MAIL_INTAKE_OFF once the admin has switched the service off", async () => {
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "mailIntake"] }));
    const res = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", cookie)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAIL_INTAKE_OFF");
    expect((await request(app).get("/api/v1/mail-intake").set("Cookie", cookie)).body.off).toBe(
      "admin"
    );
  });

  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.10", "169.254.169.254", "localhost"])(
    "refuses to save a personal host that resolves to a private address (%s) — no SSRF, no port scan",
    async (host) => {
      const res = await request(app)
        .put("/api/v1/mail-intake/source")
        .set("Cookie", cookie)
        .send({ ...body, host });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MAIL_HOST_BLOCKED");
      expect(await prisma.mailIntakeSource.count()).toBe(0);
    }
  );

  it("a connection test to a blocked host answers blocked_host without connecting; the admin's mailbox is not restricted", async () => {
    await prisma.mailIntakeSource.create({
      data: {
        kind: "imap_folder",
        userId,
        host: "10.0.0.5",
        port: 993,
        username: "u",
        folder: "F",
        passwordEncrypted: encrypt("pw"),
      },
    });
    const res = await request(app).post("/api/v1/mail-intake/source/test").set("Cookie", cookie);
    expect(res.body).toEqual({ ok: false, error: "blocked_host" });
    const saved = await request(app)
      .put("/api/v1/mail-intake/instance")
      .set("Cookie", adminCookie)
      .send({ ...instanceBody, host: "192.168.1.9", tlsMode: "none" });
    expect(saved.status).toBe(200);
  });

  it("run-now without a mailbox is a 404, not an empty success", async () => {
    const res = await request(app).post("/api/v1/mail-intake/source/run").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MAIL_SOURCE_NOT_FOUND");
  });

  it("the shared demo account cannot store a mailbox", async () => {
    const res = await request(app)
      .put("/api/v1/mail-intake/source")
      .set("Cookie", demoCookie)
      .send(body);
    expect(res.status).toBe(403);
  });

  describe("forwarding address", () => {
    it("cannot be issued while the instance has no mailbox (409 NOT_CONFIGURED)", async () => {
      const res = await request(app).post("/api/v1/mail-intake/address").set("Cookie", cookie);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_CONFIGURED");
    });

    it("the instance mailbox is admin-only", async () => {
      expect(
        (await request(app).get("/api/v1/mail-intake/instance").set("Cookie", cookie)).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .put("/api/v1/mail-intake/instance")
            .set("Cookie", cookie)
            .send(instanceBody)
        ).status
      ).toBe(403);
    });

    it("is issued once the admin has switched the mailbox on, replaced on rotate and gone on revoke", async () => {
      const saved = await request(app)
        .put("/api/v1/mail-intake/instance")
        .set("Cookie", adminCookie)
        .send({ ...instanceBody, tlsMode: "none", enabled: true });
      expect(saved.status).toBe(200);
      expect(saved.body.source.tlsMode).toBe("none"); // plain IMAP is the admin's call
      expect(JSON.stringify(saved.body)).not.toContain("secret-pw");

      const first = await request(app).post("/api/v1/mail-intake/address").set("Cookie", cookie);
      expect(first.body.address).toMatch(/^trips\+[a-z2-9]{10}@example\.org$/);
      const status = await request(app).get("/api/v1/mail-intake").set("Cookie", cookie);
      expect(status.body.address).toBe(first.body.address);

      const second = await request(app).post("/api/v1/mail-intake/address").set("Cookie", cookie);
      expect(second.body.address).not.toBe(first.body.address);

      await request(app).delete("/api/v1/mail-intake/address").set("Cookie", cookie);
      expect(
        (await request(app).get("/api/v1/mail-intake").set("Cookie", cookie)).body.address
      ).toBeNull();
    });
  });

  it("allows, lists and removes senders per user", async () => {
    const added = await request(app)
      .post("/api/v1/mail-intake/senders")
      .set("Cookie", cookie)
      .send({ address: "Me@Gmail.Example" });
    expect(added.body.senders.map((s: { address: string }) => s.address)).toEqual([
      "me@gmail.example",
    ]);
    const id = added.body.senders[0].id;
    const other = await request(app).get("/api/v1/mail-intake").set("Cookie", adminCookie);
    expect(other.body.senders).toEqual([]);
    const removed = await request(app)
      .delete(`/api/v1/mail-intake/senders/${id}`)
      .set("Cookie", cookie);
    expect(removed.body.senders).toEqual([]);
  });

  it("deleting the account removes its mailbox, address and senders", async () => {
    const pw = await hashPassword("password123");
    const tmp = await prisma.user.create({ data: { username: `${prefix}-tmp`, passwordHash: pw } });
    const src = await prisma.mailIntakeSource.create({
      data: {
        kind: "imap_folder",
        userId: tmp.id,
        host: "h",
        port: 993,
        username: "u",
        folder: "F",
      },
    });
    await prisma.mailIntakeAddress.create({
      data: { userId: tmp.id, tokenHash: `h-${prefix}`, tokenEncrypted: "x" },
    });
    await prisma.mailIntakeSender.create({ data: { userId: tmp.id, address: "a@b.example" } });
    await prisma.user.delete({ where: { id: tmp.id } });
    expect(await prisma.mailIntakeSource.count({ where: { id: src.id } })).toBe(0);
    expect(await prisma.mailIntakeAddress.count({ where: { userId: tmp.id } })).toBe(0);
    expect(await prisma.mailIntakeSender.count({ where: { userId: tmp.id } })).toBe(0);
  });
});

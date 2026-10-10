import request from "supertest";
import crypto from "crypto";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#88 acceptance, 2026-10-10: an expired reset link only said so after
 * the reader had typed a new password twice. The page now asks first. The
 * answer must be about the token alone — never a username or anything that
 * says whether an account exists.
 */
const hash = (t: string): string => crypto.createHash("sha256").update(t).digest("hex");

describe("POST /api/v1/auth/reset-password/check", () => {
  const good = "check-good-" + crypto.randomBytes(8).toString("hex");
  const old = "check-old-" + crypto.randomBytes(8).toString("hex");
  const names = ["resetCheckFresh", "resetCheckStale"];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: names } } });
    const passwordHash = await hashPassword("password123");
    await prisma.user.create({
      data: {
        username: names[0],
        passwordHash,
        resetToken: hash(good),
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.user.create({
      data: {
        username: names[1],
        passwordHash,
        resetToken: hash(old),
        resetTokenExpiry: new Date(Date.now() - 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: names } } });
  });

  it("says a live token is valid, and says nothing else", async () => {
    const res = await request(app).post("/api/v1/auth/reset-password/check").send({ token: good });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it("says an expired token is not valid", async () => {
    const res = await request(app).post("/api/v1/auth/reset-password/check").send({ token: old });
    expect(res.body).toEqual({ valid: false });
  });

  it("answers an unknown token exactly like an expired one", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password/check")
      .send({ token: "no-such-token" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
  });

  it("does not consume or change the token", async () => {
    await request(app).post("/api/v1/auth/reset-password/check").send({ token: good });
    const row = await prisma.user.findFirst({ where: { username: names[0] } });
    expect(row?.resetToken).toBe(hash(good));
  });

  it("refuses a missing token", async () => {
    const res = await request(app).post("/api/v1/auth/reset-password/check").send({});
    expect(res.status).toBe(400);
  });
});

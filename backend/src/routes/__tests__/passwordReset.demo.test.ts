import request from "supertest";

// No mail leaves the test. The route catches a send failure and answers 200
// either way, so a real transport would prove nothing and would open a socket.
jest.mock("../../services/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { SMTP_CONFIG_ID } from "../admin/smtp";
import { sendPasswordResetEmail } from "../../services/emailService";

/**
 * Finding C3: a visitor set the shared demo account's notification address and
 * then asked for a password reset. The link arrived in their inbox, they set a
 * password of their own, and every other visitor was locked out of the login
 * the front page advertises.
 *
 * The address is now refused (settings/index.ts), but a stale one could still
 * be sitting on the row after an upgrade — so the reset itself refuses the
 * shared account too. It answers exactly what it answers for an unknown
 * username, because saying "not for this account" would be a new enumeration
 * oracle for the one account whose existence is published anyway.
 */
describe("forgot-password and the shared demo account", () => {
  const ids: string[] = [];
  let smtpExisted = false;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "resetVictim"] } } });
    const demo = await prisma.user.create({
      data: {
        username: "demo",
        passwordHash: await hashPassword("demo123"),
        isDemo: true,
        notificationEmail: "attacker@example.com",
      },
    });
    const victim = await prisma.user.create({
      data: {
        username: "resetVictim",
        passwordHash: await hashPassword("password123"),
        notificationEmail: "owner@example.com",
      },
    });
    ids.push(demo.id, victim.id);

    const existing = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
    smtpExisted = existing !== null;
    if (!smtpExisted) {
      await prisma.smtpConfig.create({
        data: {
          id: SMTP_CONFIG_ID,
          host: "smtp.invalid",
          port: 587,
          username: "u",
          password: "p",
          fromEmail: "noreply@example.com",
          enabled: true,
        },
      });
    } else {
      await prisma.smtpConfig.update({ where: { id: SMTP_CONFIG_ID }, data: { enabled: true } });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (!smtpExisted) await prisma.smtpConfig.deleteMany({ where: { id: SMTP_CONFIG_ID } });
  });

  it("mints no reset token for the shared demo account", async () => {
    const res = await request(app).post("/api/v1/auth/forgot-password").send({ username: "demo" });
    expect(res.status).toBe(200);
    // The same sentence an unknown username gets.
    expect(res.body.message).toMatch(/If the username exists/i);

    const after = await prisma.user.findUnique({
      where: { username: "demo" },
      select: { resetToken: true, resetTokenExpiry: true },
    });
    expect(after?.resetToken).toBeNull();
    expect(after?.resetTokenExpiry).toBeNull();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("still mints one for an ordinary account — the test above is not vacuous", async () => {
    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ username: "resetVictim" });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({
      where: { username: "resetVictim" },
      select: { resetToken: true },
    });
    expect(after?.resetToken).not.toBeNull();
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });
});

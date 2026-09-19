import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import request from "supertest";

// No mail leaves the test — the SMTP-enabled case below would otherwise open a
// socket to prove something this file does not measure.
jest.mock("../../services/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { SMTP_CONFIG_ID } from "../admin/smtp";

/**
 * forgejo#88, point 2 — a password-reset request on an instance that cannot
 * send mail reaches an administrator instead of nobody.
 *
 * The two properties that matter are in tension, and both are pinned here:
 *
 * 1. The caller must not be able to tell whether the account exists. The
 *    response is byte-identical for a real and an invented username, and the
 *    only thing that differs is a row the caller cannot read.
 * 2. An administrator must be able to see the request — and ONLY an
 *    administrator. A normal user reading this list would be reading a list of
 *    who is locked out of the instance.
 */

const NAMES = ["prr-known", "prr-admin", "prr-plain", "prr-mailed"];
const cleanup = async (): Promise<void> => {
  // The whole table, not just this file's users: three assertions below count
  // rows globally, which is the honest way to prove "no row was written" — and
  // only this feature ever writes here.
  await prisma.passwordResetRequest.deleteMany({});
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
};

const setSmtpEnabled = async (enabled: boolean): Promise<void> => {
  await prisma.smtpConfig.upsert({
    where: { id: SMTP_CONFIG_ID },
    create: {
      id: SMTP_CONFIG_ID,
      host: "smtp.invalid",
      port: 587,
      username: "u",
      password: "p",
      fromEmail: "noreply@example.com",
      enabled,
    },
    update: { enabled },
  });
};

const forgot = (username: string) =>
  request(app).post("/api/v1/auth/forgot-password").send({ username });

const openRequests = (token: string) =>
  request(app)
    .get("/api/v1/admin/password-reset-requests")
    .set("Cookie", [`auth_token=${token}`]);

describe("password-reset requests reach the admin inbox (forgejo#88)", () => {
  let knownId = "";
  let adminToken = "";
  let plainToken = "";

  beforeEach(async () => {
    await cleanup();
    await setSmtpEnabled(false);

    const known = await prisma.user.create({
      data: { username: "prr-known", passwordHash: "x" },
    });
    knownId = known.id;
    const admin = await prisma.user.create({
      data: { username: "prr-admin", passwordHash: "x", isAdmin: true },
    });
    const plain = await prisma.user.create({
      data: { username: "prr-plain", passwordHash: "x" },
    });
    adminToken = generateToken(admin.id);
    plainToken = generateToken(plain.id);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.smtpConfig.deleteMany({ where: { id: SMTP_CONFIG_ID } });
  });

  it("records one request for a known username, and answers exactly as before", async () => {
    const res = await forgot("prr-known");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If the username exists/i);

    const row = await prisma.passwordResetRequest.findUnique({ where: { userId: knownId } });
    expect(row).not.toBeNull();
    expect(row?.handledAt).toBeNull();
  });

  it("records nothing for a username that does not exist — and says the same thing", async () => {
    const known = await forgot("prr-known");
    const unknown = await forgot("prr-nobody-at-all");

    // The anti-enumeration property, stated as an equality rather than two
    // separate assertions: a difference of any kind is the oracle.
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);

    expect(await prisma.passwordResetRequest.count()).toBe(1);
  });

  it("keeps a second ask as one open question, with the newer timestamp", async () => {
    await forgot("prr-known");
    const first = await prisma.passwordResetRequest.findUnique({ where: { userId: knownId } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await forgot("prr-known");

    const rows = await prisma.passwordResetRequest.findMany({ where: { userId: knownId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].requestedAt.getTime()).toBeGreaterThan(first!.requestedAt.getTime());
  });

  it("records nothing when the instance CAN send mail — the mail is the answer then", async () => {
    await setSmtpEnabled(true);
    await prisma.user.create({
      data: { username: "prr-mailed", passwordHash: "x", notificationEmail: "owner@example.com" },
    });

    const res = await forgot("prr-mailed");

    expect(res.status).toBe(200);
    expect(await prisma.passwordResetRequest.count()).toBe(0);
  });

  it("shows the request to an admin, with the username and when it was asked", async () => {
    await forgot("prr-known");

    const res = await openRequests(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.requests[0]).toMatchObject({ userId: knownId, username: "prr-known" });
    expect(typeof res.body.requests[0].requestedAt).toBe("string");
  });

  it("refuses a signed-in non-admin", async () => {
    await forgot("prr-known");

    const res = await openRequests(plainToken);

    expect(res.status).toBe(403);
    expect(res.body.requests).toBeUndefined();
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get("/api/v1/admin/password-reset-requests");
    expect(res.status).toBe(401);
  });

  it("clears the request once the admin marks it handled, and refuses a second click", async () => {
    await forgot("prr-known");
    const listed = await openRequests(adminToken);
    const id = listed.body.requests[0].id;

    const handled = await request(app)
      .post(`/api/v1/admin/password-reset-requests/${id}/handled`)
      .set("Cookie", [`auth_token=${adminToken}`]);

    expect(handled.status).toBe(200);
    expect(handled.body).toMatchObject({ id });
    expect(typeof handled.body.handledAt).toBe("string");

    const after = await openRequests(adminToken);
    expect(after.body.count).toBe(0);

    const again = await request(app)
      .post(`/api/v1/admin/password-reset-requests/${id}/handled`)
      .set("Cookie", [`auth_token=${adminToken}`]);
    expect(again.status).toBe(404);
  });

  it("re-opens the handled request when the same user asks again", async () => {
    await forgot("prr-known");
    const listed = await openRequests(adminToken);
    await request(app)
      .post(`/api/v1/admin/password-reset-requests/${listed.body.requests[0].id}/handled`)
      .set("Cookie", [`auth_token=${adminToken}`]);

    await forgot("prr-known");

    const after = await openRequests(adminToken);
    expect(after.body.count).toBe(1);
    expect(await prisma.passwordResetRequest.count()).toBe(1);
  });
});

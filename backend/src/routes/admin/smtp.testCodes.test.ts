/**
 * The SMTP connection test used to answer the transport's raw message
 * ("Invalid login: 535 5.7.8 …"). It answers a stable code now, uses the stored
 * password when the form leaves it out, and never forwards the server's text.
 */
import { describe, it, expect, beforeAll, afterEach, jest } from "@jest/globals";
import request from "supertest";

const testSmtpConnection = jest.fn<(config: unknown) => Promise<void>>();
jest.mock("../../services/emailService", () => ({
  sendInvitationEmail: jest.fn(),
  testSmtpConnection: (config: unknown) => testSmtpConnection(config),
}));

import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { SMTP_CONFIG_ID } from "./smtp";
import { loadAllTests } from "../../services/externalServices/tests";

const form = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "postmaster@example.com",
  fromEmail: "noreply@example.com",
  fromName: "TravStats",
  enabled: true,
};

describe("admin/smtp — POST /test answers stable codes", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `smtp-codes-${Date.now()}`,
        passwordHash: "x",
        isAdmin: true,
      },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    testSmtpConnection.mockReset();
    await prisma.smtpConfig.deleteMany({ where: { id: SMTP_CONFIG_ID } });
  });

  const post = (body: object) =>
    request(app).post("/api/v1/admin/smtp/test").set("Cookie", cookie).send(body);

  it("answers SMTP_AUTH for a refused login without the server's text", async () => {
    testSmtpConnection.mockRejectedValue(
      Object.assign(new Error("Invalid login: 535 5.7.8 user alice@secret.example"), {
        code: "EAUTH",
        responseCode: 535,
      })
    );
    const res = await post({ ...form, password: "pw" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, code: "SMTP_AUTH" });
    expect(JSON.stringify(res.body)).not.toContain("alice");
  });

  it("answers SMTP_TIMEOUT, SMTP_TLS and SMTP_CONNECTION for their causes", async () => {
    for (const [props, code] of [
      [{ code: "ETIMEDOUT" }, "SMTP_TIMEOUT"],
      [{ code: "ETLS" }, "SMTP_TLS"],
      [{ code: "ECONNECTION" }, "SMTP_CONNECTION"],
    ] as const) {
      testSmtpConnection.mockRejectedValueOnce(Object.assign(new Error("raw"), props));
      const res = await post({ ...form, password: "pw" });
      expect(res.body.code).toBe(code);
    }
  });

  it("tests with the stored password when the form leaves it out", async () => {
    await prisma.smtpConfig.create({
      data: { id: SMTP_CONFIG_ID, ...form, password: encryptApiKey("stored-secret") ?? "" },
    });
    testSmtpConnection.mockResolvedValue(undefined);
    const res = await post(form);
    expect(res.status).toBe(200);
    expect(testSmtpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ password: "stored-secret" })
    );
  });

  it("says SMTP_PASSWORD_MISSING when there is neither a typed nor a stored password", async () => {
    const res = await post(form);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, code: "SMTP_PASSWORD_MISSING" });
    expect(testSmtpConnection).not.toHaveBeenCalled();
  });

  it("keeps the verdict of a test mail as the service's last test (Letzte Testmail)", async () => {
    await prisma.externalServiceTest.deleteMany({ where: { userId: null, serviceId: "smtp" } });
    testSmtpConnection.mockRejectedValueOnce(Object.assign(new Error("raw"), { code: "EAUTH" }));
    await post({ ...form, password: "pw" });
    const failed = await loadAllTests(null);
    expect(failed.get("smtp")).toMatchObject({ ok: false, reason: "SMTP_AUTH" });

    testSmtpConnection.mockResolvedValueOnce(undefined);
    await post({ ...form, password: "pw" });
    const passed = await loadAllTests(null);
    expect(passed.get("smtp")).toMatchObject({ ok: true, reason: null });
    await prisma.externalServiceTest.deleteMany({ where: { userId: null, serviceId: "smtp" } });
  });
});
